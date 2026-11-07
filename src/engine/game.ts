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
  PIECE_LETTER,
  findKing,
  initialPosition,
  opposite,
  rankOf,
  squareName,
} from './board';
import { type CardType, type Rng, countCards, shuffledDeck } from './cards';
import { type Move, applyMove, generateMoves, isAttacked, promotionRank } from './moves';

export type Action =
  | { kind: 'draw' }
  | { kind: 'move'; from: Square; to: Square; promotion?: PieceType }
  | { kind: 'drop'; piece: PieceType; to: Square }
  | { kind: 'teleport'; from: Square; to: Square }
  | { kind: 'endTurn' }
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
  card: CardType;
  actions: string[];
  note?: string;
}

export type ResultReason = 'king-captured' | 'resigned' | 'turn-limit' | 'insufficient-material';

export interface GameResult {
  /** null means a draw. */
  winner: Color | null;
  reason: ResultReason;
}

export type Phase = 'draw' | 'act' | 'over';

/** Optional rule variations, fixed when a game is created. */
export interface GameRules {
  /**
   * A Double Move ends as soon as the enemy king is attacked, so a king can
   * never be checked and captured in one turn without a chance to respond.
   * (Borrowed from Marseillais double-move chess.)
   */
  checkEndsDoubleMove: boolean;
}

export const DEFAULT_RULES: GameRules = { checkEndsDoubleMove: true };

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
  /** Remaining draw pile per player. Hidden from clients (see toView). */
  decks: Record<Color, CardType[]>;
  lastAction: Record<Color, UndoRecord | null>;
  turnNumber: number;
  log: TurnLog[];
  /** Squares touched by the most recent turn, for "last move" highlighting. */
  highlight: Square[];
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
    decks: { w: shuffledDeck(rng), b: shuffledDeck(rng) },
    lastAction: { w: null, b: null },
    turnNumber: 1,
    log: [],
    highlight: [],
    result: null,
  };
}

export function toView(state: GameState): GameView {
  const { decks, ...rest } = state;
  return { ...rest, deckCounts: { w: countCards(decks.w), b: countCards(decks.b) } };
}

export type ActionContext = Pick<GameState, 'pos' | 'phase' | 'card' | 'movesMade' | 'inventory'>;

export interface LegalActions {
  moves: Move[];
  drops: { piece: PieceType; to: Square }[];
  teleports: { from: Square; to: Square }[];
  canEndTurn: boolean;
}

/** Piece types the Wild card can bring back (captured pawns and kings cannot). */
export const droppable = (t: PieceType): boolean => t !== 'p' && t !== 'k';

export function legalActions(ctx: ActionContext): LegalActions {
  const none: LegalActions = { moves: [], drops: [], teleports: [], canEndTurn: false };
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

  result.canEndTurn = ctx.card === 'double' && ctx.movesMade >= 1;
  return result;
}

export function hasAnyAction(a: LegalActions): boolean {
  return a.moves.length > 0 || a.drops.length > 0 || a.teleports.length > 0;
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
): ActionResult {
  if (state.phase === 'over') return fail('The game is over.');

  const s = structuredClone(state);

  if (action.kind === 'resign') {
    s.phase = 'over';
    s.result = { winner: opposite(actor), reason: 'resigned' };
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
  }
}

const fail = (error: string): ActionResult => ({ ok: false, error });

function currentLog(s: GameState): TurnLog {
  return s.log[s.log.length - 1];
}

function drawCard(s: GameState, rng: Rng): void {
  const color = s.pos.turn;
  if (s.decks[color].length === 0) s.decks[color] = shuffledDeck(rng);
  const card = s.decks[color].pop()!;

  s.card = card;
  s.log.push({ turn: s.turnNumber, color, card, actions: [] });

  if (card === 'skip') {
    currentLog(s).note = 'Turn skipped.';
    endTurn(s);
    return;
  }

  if (card === 'undo') {
    const undone = undoLastAction(s, color);
    currentLog(s).note = undone ? `Took back ${undone}.` : 'Nothing to take back.';
    endTurn(s);
    return;
  }

  s.phase = 'act';
  s.movesLeft = card === 'double' ? 2 : 1;
  s.movesMade = 0;

  if (!hasAnyAction(legalActions(s))) {
    currentLog(s).note = 'No legal moves.';
    endTurn(s);
  }
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
  const legal = generateMoves(s.pos, color).some(
    (m) => m.from === move.from && m.to === move.to && (m.promotion ?? null) === (move.promotion ?? null),
  );
  if (!legal) return fail('That move is not allowed.');

  const prevCastling = { ...s.pos.castling[color] };
  const r = applyMove(s.pos, move, true);
  s.pos = r.pos;
  const text = moveText(r, move);

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
    s.phase = 'over';
    s.result = { winner: color, reason: 'king-captured' };
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

function endTurn(s: GameState): void {
  const color = s.pos.turn;
  // An opponent's en passant chance lasts only for the turn right after it.
  if (s.pos.ep && s.pos.ep.by !== color) s.pos.ep = null;

  s.pos.turn = opposite(color);
  s.phase = 'draw';
  s.card = null;
  s.movesLeft = 0;
  s.movesMade = 0;
  s.turnNumber++;

  const onlyKings = s.pos.board.every((p) => !p || p.type === 'k');
  if (onlyKings) {
    s.phase = 'over';
    s.result = { winner: null, reason: 'insufficient-material' };
  } else if (s.turnNumber > MAX_TURNS) {
    s.phase = 'over';
    s.result = { winner: null, reason: 'turn-limit' };
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
      if (rec.captured) {
        inv.splice(inv.indexOf(rec.captured.type), 1);
        b[rec.captureSquare] = rec.captured;
      }
      if (rec.rook) {
        b[rec.rook.from] = b[rec.rook.to];
        b[rec.rook.to] = null;
      }
      s.pos.castling[color] = { ...rec.prevCastling };
      s.highlight = [rec.from, rec.to];
      break;
    }
    case 'drop': {
      if (!samePiece(b[rec.square], { type: rec.piece, color })) return null;
      b[rec.square] = { type: 'p', color };
      inv.push(rec.piece);
      s.highlight = [rec.square];
      break;
    }
    case 'teleport': {
      if (!samePiece(b[rec.to], rec.piece) || b[rec.from]) return null;
      b[rec.from] = b[rec.to];
      b[rec.to] = null;
      s.pos.castling[color] = { ...rec.prevCastling };
      s.highlight = [rec.from, rec.to];
      break;
    }
  }

  s.lastAction[color] = null;
  return rec.text;
}

export function describeResult(result: GameResult, names: Record<Color, string>): string {
  if (!result.winner) {
    return result.reason === 'turn-limit'
      ? `Draw: the ${MAX_TURNS}-turn limit was reached.`
      : 'Draw: only the kings are left.';
  }
  const winner = names[result.winner];
  return result.reason === 'resigned'
    ? `${winner} wins: ${names[opposite(result.winner)]} resigned.`
    : `${winner} wins by capturing the king!`;
}

