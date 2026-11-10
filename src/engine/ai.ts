// Computer opponent: alpha-beta search over normal chess moves, with the
// current card's special actions (double move, teleport, wild swap) at the root.
//
// The search assumes future turns are ordinary single moves; it does not try to
// predict which cards will be drawn. That keeps it fast and still makes it
// careful about leaving its king where it can be captured.

import {
  type Color,
  type PieceType,
  type Position,
  type Square,
  cloneCastling,
  fileOf,
  opposite,
  rankOf,
  findKing,
} from './board';
import { type Move, applyMove, generateMoves, isAttacked } from './moves';
import { type Action, type ActionContext, kingInDanger, legalActions, winsByCheckmate } from './game';
import type { CardType, Rng } from './cards';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: Record<Difficulty, { label: string; depth: number; quiescence: number; noise: number }> = {
  easy: { label: 'Easy', depth: 1, quiescence: 0, noise: 90 },
  medium: { label: 'Medium', depth: 2, quiescence: 4, noise: 0 },
  hard: { label: 'Hard', depth: 3, quiescence: 8, noise: 0 },
};

const VALUE: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const WIN = 1_000_000;
/** Roughly the chance of drawing Skip or Undo next turn, times a big loss. */
const KING_EXPOSED_PENALTY = 150;

function squareBonus(type: PieceType, sq: Square, color: Color): number {
  const f = fileOf(sq);
  const r = color === 'w' ? rankOf(sq) : 7 - rankOf(sq);
  const centre = 3.5 - Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5)); // 0 (edge) .. 3 (centre)
  switch (type) {
    case 'p':
      return r * 6 + (f >= 2 && f <= 5 ? r * 3 : 0);
    case 'n':
      return centre * 12 - 15;
    case 'b':
      return centre * 6;
    case 'r':
      return r === 6 ? 20 : 0;
    case 'q':
      return centre * 3;
    case 'k':
      return r === 0 ? 15 : -r * 12;
  }
}

/** Static evaluation from the point of view of the side to move. */
function evaluate(pos: Position): number {
  let score = 0;
  const me = pos.turn;
  for (let s = 0; s < 64; s++) {
    const p = pos.board[s];
    if (!p) continue;
    const v = VALUE[p.type] + squareBonus(p.type, s, p.color);
    score += p.color === me ? v : -v;
  }
  const king = findKing(pos.board, me);
  if (king >= 0 && isAttacked(pos.board, king, opposite(me))) score -= KING_EXPOSED_PENALTY;
  return score;
}

function orderMoves(pos: Position, moves: Move[]): Move[] {
  const key = (m: Move) => {
    const victim = pos.board[m.to];
    const attacker = pos.board[m.from]!;
    let k = 0;
    if (victim) k += 10 * VALUE[victim.type] - VALUE[attacker.type] + 10_000;
    if (m.promotion) k += VALUE[m.promotion];
    return k;
  };
  return moves.sort((a, b) => key(b) - key(a));
}

function child(pos: Position, move: Move): Position {
  const next = applyMove(pos, move).pos;
  next.turn = opposite(pos.turn);
  return next;
}

const capturesKing = (pos: Position, m: Move) => pos.board[m.to]?.type === 'k';

class Search {
  nodes = 0;
  constructor(private quiescenceDepth: number) {}

  negamax(pos: Position, depth: number, alpha: number, beta: number, ply: number): number {
    if (depth <= 0) return this.quiesce(pos, alpha, beta, ply, this.quiescenceDepth);
    this.nodes++;

    const moves = generateMoves(pos);
    if (moves.some((m) => capturesKing(pos, m))) return WIN - ply;
    if (moves.length === 0) return evaluate(pos);

    let best = -Infinity;
    for (const m of orderMoves(pos, moves)) {
      const score = -this.negamax(child(pos, m), depth - 1, -beta, -alpha, ply + 1);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  quiesce(pos: Position, alpha: number, beta: number, ply: number, depth: number): number {
    this.nodes++;
    const captures = generateMoves(pos).filter((m) => pos.board[m.to]);
    if (captures.some((m) => capturesKing(pos, m))) return WIN - ply;

    const standPat = evaluate(pos);
    if (depth <= 0 || standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;

    for (const m of orderMoves(pos, captures)) {
      const score = -this.quiesce(child(pos, m), -beta, -alpha, ply + 1, depth - 1);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }
}

interface Candidate {
  action: Action;
  pos: Position;
}

function rootCandidates(ctx: ActionContext): Candidate[] {
  const legal = legalActions(ctx);
  const { pos } = ctx;
  const out: Candidate[] = [];

  for (const m of legal.moves) {
    out.push({ action: { kind: 'move', ...m }, pos: applyMove(pos, m, true).pos });
  }
  for (const d of legal.drops) {
    const board = pos.board.slice();
    board[d.to] = { type: d.piece, color: pos.turn };
    out.push({ action: { kind: 'drop', ...d }, pos: { ...pos, board } });
  }
  for (const t of legal.teleports) {
    const board = pos.board.slice();
    board[t.to] = board[t.from];
    board[t.from] = null;
    out.push({ action: { kind: 'teleport', ...t }, pos: { ...pos, board, castling: cloneCastling(pos.castling) } });
  }
  if (legal.canEndTurn) out.push({ action: { kind: 'endTurn' }, pos });
  return out;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Card hand mode: roughly how much (in centipawns) a kept card is worth holding on to. */
const HOLD_VALUE: Partial<Record<CardType, number>> = { double: 70, teleport: 60, wild: 45 };
const holdValue = (c: CardType | null) => (c ? (HOLD_VALUE[c] ?? 0) : 0);

type ChooseContext = ActionContext & { movesLeft: number };

/**
 * Pick the computer's next action. Call repeatedly: it returns one action at a
 * time (draw, then each move of the turn, and in card hand mode possibly
 * keeping or playing a card first).
 */
export function chooseAction(ctx: ChooseContext, difficulty: Difficulty, rng: Rng = Math.random): Action {
  if (ctx.phase === 'draw') return { kind: 'draw' };

  const legal = legalActions(ctx);
  if (!legal.canKeep && legal.playable.length === 0) return bestPlay(ctx, difficulty, rng).action;

  // Card hand mode: compare playing the drawn card, keeping it (and making a
  // normal move), and playing each kept card instead.
  const options: { action: Action; score: number }[] = [bestPlay(ctx, difficulty, rng)];
  if (legal.canKeep) {
    const asMove = bestPlay({ ...ctx, card: 'move', movesLeft: 1, handUsed: true }, difficulty, rng);
    options.push({ action: { kind: 'keep' }, score: asMove.score + holdValue(ctx.card) });
  }
  for (const card of legal.playable) {
    const played = bestPlay({ ...ctx, card, movesLeft: card === 'double' ? 2 : 1, handUsed: true }, difficulty, rng);
    const swappedIn = ctx.card && ctx.card !== 'move' ? holdValue(ctx.card) : 0;
    options.push({ action: { kind: 'playKept', card }, score: played.score - holdValue(card) + swappedIn });
  }
  return options.reduce((a, b) => (b.score > a.score ? b : a)).action;
}

/** The best action with the card currently in play, and its score. */
function bestPlay(ctx: ChooseContext, difficulty: Difficulty, rng: Rng): { action: Action; score: number } {
  const settings = DIFFICULTIES[difficulty];
  const me = ctx.pos.turn;
  const candidates = shuffle(rootCandidates(ctx), rng);
  if (candidates.length === 0) return { action: { kind: 'endTurn' }, score: -Infinity };

  // Capturing the king wins on the spot (never offered when playing to checkmate).
  const winning = candidates.find(
    (c) => c.action.kind === 'move' && ctx.pos.board[c.action.to]?.type === 'k',
  );
  if (winning) return { action: winning.action, score: WIN };

  // Big root sets (teleport, first half of a double move) get a shallower search.
  const extraMove = ctx.movesLeft > 1;
  const depth = candidates.length > 120 || extraMove ? Math.max(1, settings.depth - 1) : settings.depth;
  const search = new Search(settings.quiescence);
  const kingsCanBeTaken = !winsByCheckmate(ctx.rules);

  const opponentToMove = (pos: Position): Position => ({ ...pos, turn: opposite(me) });

  /** Score of a position where we have finished our turn. */
  const afterTurn = (pos: Position, alpha: number) => -search.negamax(opponentToMove(pos), depth, -Infinity, -alpha, 1);

  /** Score of a position where we may still make one more (optional) move. */
  const withFollowUp = (pos: Position, alpha: number) => {
    let best = afterTurn(pos, alpha);
    if (ctx.rules.checkEndsDoubleMove && kingInDanger(pos, opposite(me))) return best;
    for (const m of orderMoves(pos, generateMoves(pos, me))) {
      if (capturesKing(pos, m)) {
        if (kingsCanBeTaken) return WIN;
        continue;
      }
      const score = afterTurn(applyMove(pos, m, true).pos, Math.max(alpha, best));
      if (score > best) best = score;
    }
    return best;
  };

  let bestAction = candidates[0].action;
  let bestScore = -Infinity;
  for (const c of candidates) {
    // With noise we need exact scores, so skip root pruning.
    const alpha = settings.noise ? -Infinity : bestScore;
    let score = extraMove && c.action.kind !== 'endTurn' ? withFollowUp(c.pos, alpha) : afterTurn(c.pos, alpha);
    if (settings.noise && Math.abs(score) < WIN / 2) score += (rng() - 0.5) * 2 * settings.noise;
    if (score > bestScore) {
      bestScore = score;
      bestAction = c.action;
    }
  }
  return { action: bestAction, score: bestScore };
}
