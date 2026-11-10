// Chance Chess game rules: turn flow, cards, and special actions.
//
// Every function here is pure (state in, new state out) so the same code runs
// in the browser for local/AI games and in the Durable Object for online games.

import {
  type Color,
  type Piece,
  type PieceType,
  type Position,
  type Square,
  type Board,
  PIECE_LETTER,
  findKing,
  initialPosition,
  opposite,
  rankOf,
  squareName,
} from './board';
import { type CardType, type Rng, CARDS, countCards, shuffledDeck } from './cards';
import { type Move, applyMove, generateMoves, isAttacked, promotionRank } from './moves';

export type Action =
  | { kind: 'draw' }
  | { kind: 'move'; from: Square; to: Square; promotion?: PieceType }
  | { kind: 'drop'; piece: PieceType; to: Square }
  | { kind: 'teleport'; from: Square; to: Square }
  | { kind: 'endTurn' }
  /** Card hand mode: keep the drawn power card for later and make a normal move now. */
  | { kind: 'keep' }
  /** Card hand mode: play a kept card instead of the one just drawn. */
  | { kind: 'playKept'; card: CardType }
  | { kind: 'resign' };

/** What is needed to take back a player's most recent action (Undo card). */
export type UndoRecord =
  | {
      kind: 'move';
      from: Square;
      to: Square;
      moved: Piece;
      placed: Piece;
      captured: Piece | null;
      captureSquare: Square;
      rook?: { from: Square; to: Square };
      prevCastling: { k: boolean; q: boolean };
      text: string;
    }
  | { kind: 'drop'; square: Square; piece: PieceType; text: string }
  | {
      kind: 'teleport';
      from: Square;
      to: Square;
      piece: Piece;
      prevCastling: { k: boolean; q: boolean };
      text: string;
    };

export interface TurnLog {
  turn: number;
  color: Color;
  /** The card drawn this turn. */
  card: CardType;
  actions: string[];
  note?: string;
  /** Skip/Undo cards shuffled back because the king was in check. */
  heldBack?: CardType[];
  /** Checkmate mode: no normal move could save the king, so this draw was the last hope. */
  lastChance?: boolean;
  /** Card hand mode: the card that went into the hand this turn. */
  kept?: CardType;
  /** Card hand mode: the kept card played instead of the drawn one. */
  played?: CardType;
}

export type ResultReason =
  | 'king-captured'
  | 'checkmate'
  | 'resigned'
  | 'timeout'
  | 'turn-limit'
  | 'insufficient-material';

export interface GameResult {
  /** null means a draw. */
  winner: Color | null;
  reason: ResultReason;
}

export type Phase = 'draw' | 'act' | 'over';

/**
 * What visibly happened on the board during the latest action, so the UI can
 * animate it (pieces sliding, teleporting, being captured or swapped in).
 */
export type BoardEvent =
  | { kind: 'slide'; from: Square; to: Square; piece: Piece }
  | { kind: 'capture'; square: Square; piece: Piece }
  | { kind: 'teleport'; from: Square; to: Square; piece: Piece }
  | { kind: 'swap'; square: Square; before: Piece; after: Piece }
  | { kind: 'appear'; square: Square; piece: Piece };

/**
 * - capture: win by capturing the king; moves may leave your own king attacked.
 * - checkmate: proper chess legality, win by checkmate (decided after the draw,
 *   so a lucky card can still save a king that normal moves can't).
 * - hand: like checkmate, but power cards can be kept and played on a later turn.
 */
export type GameMode = 'capture' | 'checkmate' | 'hand';

/** Card hand mode: cards that can be kept, and how many a hand holds. */
export const KEEPABLE: CardType[] = ['double', 'wild', 'teleport'];
export const HAND_LIMIT = 3;

/** Cards that end your turn without a move. */
const CURSED: CardType[] = ['skip', 'undo'];

/** Optional rule variations, fixed when a game is created. */
export interface GameRules {
  mode: GameMode;
  /**
   * A Double Move ends as soon as the enemy king is attacked, so a king can
   * never be checked and captured in one turn without a chance to respond.
   * (Borrowed from Marseillais double-move chess.)
   */
  checkEndsDoubleMove: boolean;
  /**
   * Skip and Undo are never dealt while your king is in check (they're
   * shuffled back in). Always on when playing to checkmate, where a king in
   * check must get its chance to escape.
   */
  noCursedInCheck: boolean;
  /** Chess clock; null plays without one. */
  timeControl: TimeControl | null;
}

export interface TimeControl {
  initialMs: number;
  /** Added to a player's clock after each of their turns. */
  incrementMs: number;
}

export const DEFAULT_RULES: GameRules = { mode: 'capture', checkEndsDoubleMove: true, noCursedInCheck: true, timeControl: null };

/** Proper chess legality and a win by checkmate (checkmate and card hand modes). */
export const winsByCheckmate = (rules: GameRules): boolean => rules.mode === 'checkmate' || rules.mode === 'hand';

/** Whether Skip and Undo are held back from a player in check under these rules. */
export const cursedHeldBack = (rules: GameRules): boolean => winsByCheckmate(rules) || rules.noCursedInCheck;

/**
 * Each side's remaining time. The side to move's clock has been running since
 * `runningSince` (a Date.now() timestamp); null means stopped.
 */
export interface Clock {
  remaining: Record<Color, number>;
  runningSince: number | null;
}

export interface GameState {
  rules: GameRules;
  pos: Position;
  phase: Phase;
  /** Card in play for the side to move (null before drawing). */
  card: CardType | null;
  movesLeft: number;
  movesMade: number;
  /** Pieces captured by each color, available to the Wild card. */
  inventory: Record<Color, PieceType[]>;
  /** Card hand mode: kept cards (visible to both players). */
  hands: Record<Color, CardType[]>;
  /** Card hand mode: already kept or played a kept card this turn. */
  handUsed: boolean;
  /** Remaining draw pile per player. Hidden from clients (see toView). */
  decks: Record<Color, CardType[]>;
  lastAction: Record<Color, UndoRecord | null>;
  turnNumber: number;
  log: TurnLog[];
  /** Squares touched by the most recent turn, for "last move" highlighting. */
  highlight: Square[];
  /** Board changes made by the most recent action. */
  events: BoardEvent[];
  /** Increases with every action, so clients can tell new events from old. */
  seq: number;
  /** null when playing without a clock. */
  clock: Clock | null;
  result: GameResult | null;
}

/** What a player is allowed to see: everything except the order of the decks. */
export type GameView = Omit<GameState, 'decks'> & {
  deckCounts: Record<Color, Record<CardType, number>>;
};

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string };

/** A game that reaches this many turns (100 each) is a draw. */
export const MAX_TURNS = 200;

export function newGame(rng: Rng = Math.random, rules: GameRules = DEFAULT_RULES): GameState {
  return {
    rules: { ...rules },
    pos: initialPosition(),
    phase: 'draw',
    card: null,
    movesLeft: 0,
    movesMade: 0,
    inventory: { w: [], b: [] },
    hands: { w: [], b: [] },
    handUsed: false,
    decks: { w: shuffledDeck(rng), b: shuffledDeck(rng) },
    lastAction: { w: null, b: null },
    turnNumber: 1,
    log: [],
    highlight: [],
    events: [],
    seq: 0,
    clock: rules.timeControl
      ? { remaining: { w: rules.timeControl.initialMs, b: rules.timeControl.initialMs }, runningSince: null }
      : null,
    result: null,
  };
}

/** Start the clock (for the side to move). Call when both players are ready. */
export function startClock(state: GameState, now: number): GameState {
  if (!state.clock || state.clock.runningSince !== null || state.phase === 'over') return state;
  return { ...state, clock: { ...state.clock, runningSince: now } };
}

/** Time `color` has left at `now`, counting the clock that is currently running. */
export function timeLeft(state: Pick<GameState, 'clock' | 'pos'>, color: Color, now: number): number {
  const clock = state.clock;
  if (!clock) return Infinity;
  const running = clock.runningSince !== null && state.pos.turn === color;
  return Math.max(0, clock.remaining[color] - (running ? now - clock.runningSince! : 0));
}

/** If the side to move has run out of time, return the finished game; otherwise null. */
export function checkTimeout(state: GameState, now: number): GameState | null {
  if (state.phase === 'over' || state.clock?.runningSince == null) return null;
  const color = state.pos.turn;
  if (timeLeft(state, color, now) > 0) return null;
  const s = structuredClone(state);
  s.clock!.remaining[color] = 0;
  s.events = [];
  s.seq++;
  finish(s, { winner: opposite(color), reason: 'timeout' });
  return s;
}

export function toView(state: GameState): GameView {
  const { decks, ...rest } = state;
  return { ...rest, deckCounts: { w: countCards(decks.w), b: countCards(decks.b) } };
}

export type ActionContext = Pick<
  GameState,
  'rules' | 'pos' | 'phase' | 'card' | 'movesMade' | 'inventory' | 'hands' | 'handUsed'
>;

export interface LegalActions {
  moves: Move[];
  drops: { piece: PieceType; to: Square }[];
  teleports: { from: Square; to: Square }[];
  canEndTurn: boolean;
  /** Card hand mode: the drawn card can be kept. */
  canKeep: boolean;
  /** Card hand mode: kept cards that can be played now. */
  playable: CardType[];
}

/** Piece types the Wild card can bring back (captured pawns and kings cannot). */
export const droppable = (t: PieceType): boolean => t !== 'p' && t !== 'k';

export function legalActions(ctx: ActionContext): LegalActions {
  const none: LegalActions = { moves: [], drops: [], teleports: [], canEndTurn: false, canKeep: false, playable: [] };
  if (ctx.phase !== 'act') return none;

  const color = ctx.pos.turn;
  const { board } = ctx.pos;
  const result: LegalActions = { ...none, moves: generateMoves(ctx.pos, color) };

  if (ctx.card === 'wild' && ctx.movesMade === 0) {
    const pieces = [...new Set(ctx.inventory[color].filter(droppable))];
    for (let s = 0; s < 64; s++) {
      const p = board[s];
      if (p && p.color === color && p.type === 'p') {
        for (const piece of pieces) result.drops.push({ piece, to: s });
      }
    }
  }

  if (ctx.card === 'teleport' && ctx.movesMade === 0) {
    for (let from = 0; from < 64; from++) {
      const p = board[from];
      if (!p || p.color !== color) continue;
      for (let to = 0; to < 64; to++) {
        if (board[to]) continue;
        // Pawns can never stand on the first or last rank.
        if (p.type === 'p' && (rankOf(to) === 0 || rankOf(to) === 7)) continue;
        result.teleports.push({ from, to });
      }
    }
  }

  if (winsByCheckmate(ctx.rules)) {
    // Proper chess: nothing may leave your own king in check, and kings are never captured.
    const safe = (b: Board) => {
      const k = findKing(b, color);
      return k < 0 || !isAttacked(b, k, opposite(color));
    };
    result.moves = result.moves.filter((m) => board[m.to]?.type !== 'k' && safe(applyMove(ctx.pos, m).pos.board));
    result.drops = result.drops.filter((d) => {
      const b = board.slice();
      b[d.to] = { type: d.piece, color };
      return safe(b);
    });
    result.teleports = result.teleports.filter((t) => {
      const b = board.slice();
      b[t.to] = b[t.from];
      b[t.from] = null;
      return safe(b);
    });
  }

  const freshTurn = ctx.rules.mode === 'hand' && ctx.movesMade === 0 && !ctx.handUsed;
  // Only offer what can actually be played: keeping leaves a normal move to
  // make, and a kept card needs a legal action of its own.
  const usable = (card: CardType) => hasAnyAction(legalActions({ ...ctx, card, handUsed: true }));
  result.canKeep =
    freshTurn && !!ctx.card && KEEPABLE.includes(ctx.card) && ctx.hands[color].length < HAND_LIMIT && usable('move');
  result.playable = freshTurn ? [...new Set(ctx.hands[color])].filter(usable) : [];
  result.canEndTurn = ctx.card === 'double' && ctx.movesMade >= 1;
  return result;
}

export function hasAnyAction(a: LegalActions): boolean {
  return a.moves.length > 0 || a.drops.length > 0 || a.teleports.length > 0 || a.playable.length > 0;
}

/**
 * Playing to checkmate, before drawing: in check and neither a normal move nor
 * a kept card helps, so only the card about to be drawn can.
 */
export function isLastChance(ctx: ActionContext): boolean {
  if (!winsByCheckmate(ctx.rules) || ctx.phase !== 'draw' || !kingInDanger(ctx.pos, ctx.pos.turn)) return false;
  return !hasAnyAction(legalActions({ ...ctx, phase: 'act', card: 'move', movesMade: 0 }));
}

/** Is `color`'s king currently attacked? (Shown as a warning; not enforced.) */
export function kingInDanger(pos: Position, color: Color): boolean {
  const k = findKing(pos.board, color);
  return k >= 0 && isAttacked(pos.board, k, opposite(color));
}

export function applyAction(
  state: GameState,
  action: Action,
  actor: Color,
  rng: Rng = Math.random,
  now: number = Date.now(),
): ActionResult {
  if (state.phase === 'over') return fail('The game is over.');

  // An action that arrives after the flag has fallen loses on time instead.
  const timedOut = checkTimeout(state, now);
  if (timedOut) return { ok: true, state: timedOut };

  const s = structuredClone(state);
  s.events = [];
  s.seq++;
  if (s.clock?.runningSince != null) {
    s.clock.remaining[s.pos.turn] -= now - s.clock.runningSince;
    s.clock.runningSince = now;
  }

  if (action.kind === 'resign') {
    finish(s, { winner: opposite(actor), reason: 'resigned' });
    return { ok: true, state: s };
  }

  if (actor !== s.pos.turn) return fail("It's not your turn.");

  switch (action.kind) {
    case 'draw':
      if (s.phase !== 'draw') return fail('You already drew a card this turn.');
      drawCard(s, rng);
      return { ok: true, state: s };

    case 'endTurn':
      if (s.phase !== 'act' || !legalActions(s).canEndTurn) return fail("You can't end your turn yet.");
      endTurn(s);
      return { ok: true, state: s };

    case 'move':
      if (s.phase !== 'act') return fail('Draw a card first.');
      return doMove(s, action);

    case 'drop':
      if (s.phase !== 'act') return fail('Draw a card first.');
      return doDrop(s, action);

    case 'teleport':
      if (s.phase !== 'act') return fail('Draw a card first.');
      return doTeleport(s, action);

    case 'keep':
      if (s.phase !== 'act' || !legalActions(s).canKeep) return fail("You can't keep this card.");
      return doKeep(s);

    case 'playKept':
      if (s.phase !== 'act' || !legalActions(s).playable.includes(action.card)) return fail("You can't play that card now.");
      return doPlayKept(s, action.card);
  }
}

const fail = (error: string): ActionResult => ({ ok: false, error });

function currentLog(s: GameState): TurnLog {
  return s.log[s.log.length - 1];
}

/**
 * Take the top card of `color`'s deck. With `holdBackCursed` (the king is in
 * check and the rules say so), Skip and Undo are shuffled back in (they would
 * lose the game on the spot) and the next card is drawn instead.
 */
function takeCard(s: GameState, color: Color, rng: Rng, holdBackCursed: boolean) {
  const deck = s.decks[color];
  const heldBack: CardType[] = [];
  for (;;) {
    if (deck.length === 0 || (holdBackCursed && deck.every((c) => CURSED.includes(c)))) deck.push(...shuffledDeck(rng));
    const card = deck.pop()!;
    if (!holdBackCursed || !CURSED.includes(card)) return { card, heldBack };
    heldBack.push(card);
    // Anywhere except straight back on top.
    deck.splice(Math.floor(rng() * deck.length), 0, card);
  }
}

function drawCard(s: GameState, rng: Rng): void {
  const color = s.pos.turn;
  const inCheck = kingInDanger(s.pos, color);
  const lastChance = isLastChance(s);
  const { card, heldBack } = takeCard(s, color, rng, inCheck && cursedHeldBack(s.rules));

  s.card = card;
  const entry: TurnLog = { turn: s.turnNumber, color, card, actions: [] };
  if (heldBack.length) entry.heldBack = heldBack;
  if (lastChance) entry.lastChance = true;
  s.log.push(entry);

  if (card === 'skip') {
    entry.note = 'Turn skipped.';
    endTurn(s);
    return;
  }

  if (card === 'undo') {
    const undone = undoLastAction(s, color);
    entry.note = undone ? `Took back ${undone}.` : 'Nothing to take back.';
    endTurn(s);
    return;
  }

  s.phase = 'act';
  s.movesLeft = card === 'double' ? 2 : 1;
  s.movesMade = 0;

  if (!hasAnyAction(legalActions(s))) {
    if (winsByCheckmate(s.rules) && inCheck) {
      entry.note = 'Checkmate!';
      finish(s, { winner: opposite(color), reason: 'checkmate' });
      return;
    }
    entry.note = 'No legal moves.';
    endTurn(s);
    return;
  }
  if (lastChance) entry.note = `Saved by the ${CARDS[card].name}!`;
}

function doKeep(s: GameState): ActionResult {
  const color = s.pos.turn;
  const kept = s.card!;
  s.hands[color].push(kept);
  s.card = 'move';
  s.movesLeft = 1;
  s.handUsed = true;
  currentLog(s).kept = kept;
  if (!hasAnyAction(legalActions(s))) {
    currentLog(s).note = 'No legal moves.';
    endTurn(s);
  }
  return { ok: true, state: s };
}

function doPlayKept(s: GameState, card: CardType): ActionResult {
  const color = s.pos.turn;
  const hand = s.hands[color];
  hand.splice(hand.indexOf(card), 1);
  // A drawn power card swaps into the hand; a drawn Move card is simply set aside.
  const drawn = s.card!;
  if (KEEPABLE.includes(drawn)) {
    hand.push(drawn);
    currentLog(s).kept = drawn;
  }
  s.card = card;
  s.movesLeft = card === 'double' ? 2 : 1;
  s.handUsed = true;
  currentLog(s).played = card;
  if (!hasAnyAction(legalActions(s))) {
    currentLog(s).note = 'No legal moves.';
    endTurn(s);
  }
  return { ok: true, state: s };
}

function moveText(r: ReturnType<typeof applyMove>, move: Move): string {
  if (r.rook) return r.rook.to > r.rook.from ? 'O-O-O' : 'O-O';
  const capture = !!r.captured;
  let text = PIECE_LETTER[r.moved.type] + squareName(move.from) + (capture ? '×' : '–') + squareName(move.to);
  if (r.placed.type !== r.moved.type) text += '=' + PIECE_LETTER[r.placed.type];
  if (capture && r.captureSquare !== move.to) text += ' e.p.';
  return text;
}

function doMove(s: GameState, action: Extract<Action, { kind: 'move' }>): ActionResult {
  const color = s.pos.turn;
  const piece = s.pos.board[action.from];
  let promotion = action.promotion;
  if (piece?.type === 'p' && rankOf(action.to) === promotionRank(color)) promotion ??= 'q';
  else promotion = undefined;

  const move: Move = { from: action.from, to: action.to, promotion };
  const legal = legalActions(s).moves.some(
    (m) => m.from === move.from && m.to === move.to && (m.promotion ?? null) === (move.promotion ?? null),
  );
  if (!legal) {
    const intoCheck = winsByCheckmate(s.rules) && generateMoves(s.pos, color).some((m) => m.from === move.from && m.to === move.to);
    return fail(intoCheck ? 'That would leave your king in check.' : 'That move is not allowed.');
  }

  const prevCastling = { ...s.pos.castling[color] };
  const r = applyMove(s.pos, move, true);
  s.pos = r.pos;
  const text = moveText(r, move);

  if (r.captured) s.events.push({ kind: 'capture', square: r.captureSquare, piece: r.captured });
  s.events.push({ kind: 'slide', from: move.from, to: move.to, piece: r.placed });
  if (r.rook) s.events.push({ kind: 'slide', from: r.rook.from, to: r.rook.to, piece: { type: 'r', color } });
  if (r.placed.type !== r.moved.type) {
    s.events.push({ kind: 'swap', square: move.to, before: r.moved, after: r.placed });
  }

  s.lastAction[color] = {
    kind: 'move',
    from: move.from,
    to: move.to,
    moved: r.moved,
    placed: r.placed,
    captured: r.captured,
    captureSquare: r.captureSquare,
    rook: r.rook,
    prevCastling,
    text,
  };

  if (r.captured?.type === 'k') {
    finish(s, { winner: color, reason: 'king-captured' });
  } else if (r.captured) {
    s.inventory[color].push(r.captured.type);
  }

  finishAction(s, text, [move.from, move.to]);
  return { ok: true, state: s };
}

function doDrop(s: GameState, action: Extract<Action, { kind: 'drop' }>): ActionResult {
  const color = s.pos.turn;
  const ok = legalActions(s).drops.some((d) => d.piece === action.piece && d.to === action.to);
  if (!ok) return fail('That swap is not allowed.');

  const inv = s.inventory[color];
  inv.splice(inv.indexOf(action.piece), 1);
  s.pos.board[action.to] = { type: action.piece, color };
  s.events.push({ kind: 'swap', square: action.to, before: { type: 'p', color }, after: { type: action.piece, color } });

  const text = `★ ${PIECE_LETTER[action.piece]} swapped in on ${squareName(action.to)}`;
  s.lastAction[color] = { kind: 'drop', square: action.to, piece: action.piece, text };
  finishAction(s, text, [action.to]);
  return { ok: true, state: s };
}

function doTeleport(s: GameState, action: Extract<Action, { kind: 'teleport' }>): ActionResult {
  const color = s.pos.turn;
  const ok = legalActions(s).teleports.some((t) => t.from === action.from && t.to === action.to);
  if (!ok) return fail('That teleport is not allowed.');

  const piece = s.pos.board[action.from]!;
  const prevCastling = { ...s.pos.castling[color] };
  s.pos.board[action.to] = piece;
  s.pos.board[action.from] = null;
  s.events.push({ kind: 'teleport', from: action.from, to: action.to, piece });
  if (piece.type === 'k') s.pos.castling[color] = { k: false, q: false };
  if (piece.type === 'r') {
    const home = color === 'w' ? 0 : 56;
    if (action.from === home + 7) s.pos.castling[color].k = false;
    if (action.from === home) s.pos.castling[color].q = false;
  }
  if (s.pos.ep?.pawn === action.from) s.pos.ep = null;

  const text = `⌖ ${PIECE_LETTER[piece.type]}${squareName(action.from)} → ${squareName(action.to)}`;
  s.lastAction[color] = { kind: 'teleport', from: action.from, to: action.to, piece, prevCastling, text };
  finishAction(s, text, [action.from, action.to]);
  return { ok: true, state: s };
}

/** Bookkeeping after any successful move/drop/teleport. */
function finishAction(s: GameState, text: string, squares: Square[]): void {
  if (s.movesMade === 0) s.highlight = [];
  s.highlight.push(...squares);
  currentLog(s).actions.push(text);
  s.movesMade++;
  s.movesLeft--;

  if (s.phase === 'over') return;
  if (s.movesLeft > 0 && s.rules.checkEndsDoubleMove && kingInDanger(s.pos, opposite(s.pos.turn))) {
    currentLog(s).note = 'Check! The double move ends.';
    endTurn(s);
  } else if (s.movesLeft <= 0 || !hasAnyAction(legalActions(s))) {
    endTurn(s);
  }
}

function finish(s: GameState, result: GameResult): void {
  s.phase = 'over';
  s.result = result;
  if (s.clock) s.clock.runningSince = null;
}

function endTurn(s: GameState): void {
  const color = s.pos.turn;
  // An opponent's en passant chance lasts only for the turn right after it.
  if (s.pos.ep && s.pos.ep.by !== color) s.pos.ep = null;
  if (s.clock && s.rules.timeControl) s.clock.remaining[color] += s.rules.timeControl.incrementMs;

  s.pos.turn = opposite(color);
  s.phase = 'draw';
  s.card = null;
  s.movesLeft = 0;
  s.movesMade = 0;
  s.handUsed = false;
  s.turnNumber++;

  const onlyKings = s.pos.board.every((p) => !p || p.type === 'k');
  if (onlyKings) {
    finish(s, { winner: null, reason: 'insufficient-material' });
  } else if (s.turnNumber > MAX_TURNS) {
    finish(s, { winner: null, reason: 'turn-limit' });
  }
}

const samePiece = (p: Piece | null | undefined, q: Piece): boolean =>
  !!p && p.type === q.type && p.color === q.color;

/**
 * Reverse `color`'s most recent action if the board still allows it (the piece
 * is where it landed and its old square is free). Returns the action's text,
 * or null when there is nothing that can be taken back.
 */
function undoLastAction(s: GameState, color: Color): string | null {
  const before = structuredClone({ pos: s.pos, inventory: s.inventory, events: s.events, highlight: s.highlight });
  const undone = reverseLastAction(s, color);
  // Playing to checkmate, a take-back may not leave your own king in check.
  if (undone && winsByCheckmate(s.rules) && kingInDanger(s.pos, color)) {
    Object.assign(s, before);
    return null;
  }
  if (undone) s.lastAction[color] = null;
  return undone;
}

function reverseLastAction(s: GameState, color: Color): string | null {
  const rec = s.lastAction[color];
  if (!rec) return null;
  const b = s.pos.board;
  const inv = s.inventory[color];

  switch (rec.kind) {
    case 'move': {
      if (!samePiece(b[rec.to], rec.placed) || b[rec.from]) return null;
      if (rec.rook && (!samePiece(b[rec.rook.to], { type: 'r', color }) || b[rec.rook.from])) return null;
      if (rec.captured && rec.captureSquare !== rec.to && b[rec.captureSquare]) return null;
      if (rec.captured && !inv.includes(rec.captured.type)) return null;

      b[rec.from] = rec.moved;
      b[rec.to] = null;
      s.events.push({ kind: 'slide', from: rec.to, to: rec.from, piece: rec.moved });
      if (rec.captured) {
        inv.splice(inv.indexOf(rec.captured.type), 1);
        b[rec.captureSquare] = rec.captured;
        s.events.push({ kind: 'appear', square: rec.captureSquare, piece: rec.captured });
      }
      if (rec.rook) {
        b[rec.rook.from] = b[rec.rook.to];
        b[rec.rook.to] = null;
        s.events.push({ kind: 'slide', from: rec.rook.to, to: rec.rook.from, piece: { type: 'r', color } });
      }
      s.pos.castling[color] = { ...rec.prevCastling };
      s.highlight = [rec.from, rec.to];
      break;
    }
    case 'drop': {
      if (!samePiece(b[rec.square], { type: rec.piece, color })) return null;
      b[rec.square] = { type: 'p', color };
      inv.push(rec.piece);
      s.events.push({ kind: 'swap', square: rec.square, before: { type: rec.piece, color }, after: { type: 'p', color } });
      s.highlight = [rec.square];
      break;
    }
    case 'teleport': {
      if (!samePiece(b[rec.to], rec.piece) || b[rec.from]) return null;
      b[rec.from] = b[rec.to];
      b[rec.to] = null;
      s.events.push({ kind: 'teleport', from: rec.to, to: rec.from, piece: rec.piece });
      s.pos.castling[color] = { ...rec.prevCastling };
      s.highlight = [rec.from, rec.to];
      break;
    }
  }

  return rec.text;
}

export function describeResult(result: GameResult, names: Record<Color, string>): string {
  if (!result.winner) {
    return result.reason === 'turn-limit'
      ? `Draw: the ${MAX_TURNS}-turn limit was reached.`
      : 'Draw: only the kings are left.';
  }
  const winner = names[result.winner];
  const loser = names[opposite(result.winner)];
  if (result.reason === 'resigned') return `${winner} wins: ${loser} resigned.`;
  if (result.reason === 'timeout') return `${winner} wins on time: ${loser} ran out.`;
  if (result.reason === 'checkmate') return `${winner} wins by checkmate!`;
  return `${winner} wins by capturing the king!`;
}

