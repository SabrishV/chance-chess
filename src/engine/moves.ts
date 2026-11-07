// Move generation for standard chess pieces.
//
// Chance Chess uses "king capture" instead of checkmate, so moves are
// pseudo-legal: a player may leave their king attacked, and the game is won by
// actually capturing the enemy king.

import {
  type Board,
  type Color,
  type PieceType,
  type Position,
  type Square,
  type Piece,
  cloneCastling,
  fileOf,
  onBoard,
  opposite,
  rankOf,
  toSquare,
} from './board';

export interface Move {
  from: Square;
  to: Square;
  promotion?: PieceType;
}

const KNIGHT_STEPS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_STEPS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export const PROMOTION_PIECES: PieceType[] = ['q', 'r', 'b', 'n'];

export const pawnDir = (c: Color): number => (c === 'w' ? 1 : -1);
export const pawnStartRank = (c: Color): number => (c === 'w' ? 1 : 6);
export const promotionRank = (c: Color): number => (c === 'w' ? 7 : 0);

/** Is `target` attacked by any piece of color `by`? */
export function isAttacked(board: Board, target: Square, by: Color): boolean {
  const tf = fileOf(target);
  const tr = rankOf(target);

  // Pawns: a pawn of `by` attacks diagonally forward, so look one rank behind.
  const pr = tr - pawnDir(by);
  for (const df of [-1, 1]) {
    if (onBoard(tf + df, pr)) {
      const p = board[toSquare(tf + df, pr)];
      if (p && p.color === by && p.type === 'p') return true;
    }
  }

  for (const [df, dr] of KNIGHT_STEPS) {
    if (!onBoard(tf + df, tr + dr)) continue;
    const p = board[toSquare(tf + df, tr + dr)];
    if (p && p.color === by && p.type === 'n') return true;
  }

  for (const [df, dr] of KING_STEPS) {
    if (!onBoard(tf + df, tr + dr)) continue;
    const p = board[toSquare(tf + df, tr + dr)];
    if (p && p.color === by && p.type === 'k') return true;
  }

  const slides = (dirs: number[][], types: PieceType[]): boolean => {
    for (const [df, dr] of dirs) {
      let f = tf + df;
      let r = tr + dr;
      while (onBoard(f, r)) {
        const p = board[toSquare(f, r)];
        if (p) {
          if (p.color === by && types.includes(p.type)) return true;
          break;
        }
        f += df;
        r += dr;
      }
    }
    return false;
  };

  return slides(ROOK_DIRS, ['r', 'q']) || slides(BISHOP_DIRS, ['b', 'q']);
}

/** True when en passant info in the position still refers to a capturable pawn. */
function epAvailable(pos: Position, color: Color): boolean {
  const ep = pos.ep;
  if (!ep || ep.by === color) return false;
  const pawn = pos.board[ep.pawn];
  return !!pawn && pawn.type === 'p' && pawn.color === ep.by && !pos.board[ep.target];
}

/** All pseudo-legal moves for `color` (defaults to the side to move). */
export function generateMoves(pos: Position, color: Color = pos.turn): Move[] {
  const moves: Move[] = [];
  const { board } = pos;

  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || piece.color !== color) continue;
    const f = fileOf(from);
    const r = rankOf(from);

    switch (piece.type) {
      case 'p':
        pawnMoves(pos, from, color, moves);
        break;
      case 'n':
      case 'k':
        for (const [df, dr] of piece.type === 'n' ? KNIGHT_STEPS : KING_STEPS) {
          if (!onBoard(f + df, r + dr)) continue;
          const to = toSquare(f + df, r + dr);
          const target = board[to];
          if (!target || target.color !== color) moves.push({ from, to });
        }
        if (piece.type === 'k') castlingMoves(pos, from, color, moves);
        break;
      default: {
        const dirs =
          piece.type === 'r' ? ROOK_DIRS : piece.type === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
        for (const [df, dr] of dirs) {
          let nf = f + df;
          let nr = r + dr;
          while (onBoard(nf, nr)) {
            const to = toSquare(nf, nr);
            const target = board[to];
            if (target) {
              if (target.color !== color) moves.push({ from, to });
              break;
            }
            moves.push({ from, to });
            nf += df;
            nr += dr;
          }
        }
      }
    }
  }
  return moves;
}

function pushPawnMove(moves: Move[], from: Square, to: Square, color: Color): void {
  if (rankOf(to) === promotionRank(color)) {
    for (const promotion of PROMOTION_PIECES) moves.push({ from, to, promotion });
  } else {
    moves.push({ from, to });
  }
}

function pawnMoves(pos: Position, from: Square, color: Color, moves: Move[]): void {
  const { board } = pos;
  const f = fileOf(from);
  const r = rankOf(from);
  const dir = pawnDir(color);

  if (onBoard(f, r + dir) && !board[toSquare(f, r + dir)]) {
    pushPawnMove(moves, from, toSquare(f, r + dir), color);
    if (r === pawnStartRank(color) && !board[toSquare(f, r + 2 * dir)]) {
      moves.push({ from, to: toSquare(f, r + 2 * dir) });
    }
  }

  for (const df of [-1, 1]) {
    if (!onBoard(f + df, r + dir)) continue;
    const to = toSquare(f + df, r + dir);
    const target = board[to];
    if (target && target.color !== color) {
      pushPawnMove(moves, from, to, color);
    } else if (!target && epAvailable(pos, color) && pos.ep!.target === to) {
      moves.push({ from, to });
    }
  }
}

function castlingMoves(pos: Position, from: Square, color: Color, moves: Move[]): void {
  const rights = pos.castling[color];
  const homeRank = color === 'w' ? 0 : 7;
  const kingHome = toSquare(4, homeRank);
  if (from !== kingHome || (!rights.k && !rights.q)) return;

  const { board } = pos;
  const enemy = opposite(color);
  const rookAt = (file: number) => {
    const p = board[toSquare(file, homeRank)];
    return !!p && p.type === 'r' && p.color === color;
  };
  const empty = (...files: number[]) => files.every((fl) => !board[toSquare(fl, homeRank)]);
  const safe = (...files: number[]) => files.every((fl) => !isAttacked(board, toSquare(fl, homeRank), enemy));

  if (rights.k && rookAt(7) && empty(5, 6) && safe(4, 5, 6)) {
    moves.push({ from, to: toSquare(6, homeRank) });
  }
  if (rights.q && rookAt(0) && empty(1, 2, 3) && safe(4, 3, 2)) {
    moves.push({ from, to: toSquare(2, homeRank) });
  }
}

export interface MoveResult {
  pos: Position;
  /** The piece that was on `from` before the move. */
  moved: Piece;
  /** The piece now standing on `to` (differs from `moved` after promotion). */
  placed: Piece;
  captured: Piece | null;
  captureSquare: Square;
  rook?: { from: Square; to: Square };
}

/**
 * Apply a move (assumed pseudo-legal) and return the new position. The side to
 * move is NOT changed; callers decide when the turn passes.
 *
 * `keepEp` keeps an existing en passant opportunity alive (the game layer
 * expires it when the turn ends); otherwise it is cleared unless this move
 * creates one, which is plain chess behaviour and what the AI search uses.
 */
export function applyMove(pos: Position, move: Move, keepEp = false): MoveResult {
  const board = pos.board.slice();
  const castling = cloneCastling(pos.castling);
  const moved = board[move.from]!;
  const color = moved.color;
  const enemy = opposite(color);

  let captured = board[move.to];
  let captureSquare = move.to;

  // En passant capture: pawn moves diagonally onto an empty square.
  if (moved.type === 'p' && !captured && fileOf(move.from) !== fileOf(move.to) && pos.ep) {
    captureSquare = pos.ep.pawn;
    captured = board[captureSquare];
    board[captureSquare] = null;
  }

  const placed: Piece = move.promotion ? { type: move.promotion, color } : moved;
  board[move.to] = placed;
  board[move.from] = null;

  let rook: MoveResult['rook'];
  if (moved.type === 'k' && Math.abs(move.to - move.from) === 2) {
    const kingSide = move.to > move.from;
    rook = {
      from: kingSide ? move.from + 3 : move.from - 4,
      to: kingSide ? move.from + 1 : move.from - 1,
    };
    board[rook.to] = board[rook.from];
    board[rook.from] = null;
  }

  // Castling rights: moving the king or a rook, or losing a rook, forfeits them.
  const homeRank = (c: Color) => (c === 'w' ? 0 : 7);
  if (moved.type === 'k') castling[color] = { k: false, q: false };
  if (moved.type === 'r' && rankOf(move.from) === homeRank(color)) {
    if (fileOf(move.from) === 7) castling[color].k = false;
    if (fileOf(move.from) === 0) castling[color].q = false;
  }
  if (captured?.type === 'r' && rankOf(captureSquare) === homeRank(enemy)) {
    if (fileOf(captureSquare) === 7) castling[enemy].k = false;
    if (fileOf(captureSquare) === 0) castling[enemy].q = false;
  }

  let ep: Position['ep'] = null;
  if (moved.type === 'p' && Math.abs(move.to - move.from) === 16) {
    ep = { target: (move.from + move.to) / 2, pawn: move.to, by: color };
  } else if (keepEp && pos.ep && move.from !== pos.ep.pawn && captureSquare !== pos.ep.pawn) {
    ep = pos.ep;
  }

  return {
    pos: { board, turn: pos.turn, castling, ep },
    moved,
    placed,
    captured,
    captureSquare,
    rook,
  };
}

export const sameMove = (a: Move, b: Move): boolean =>
  a.from === b.from && a.to === b.to && (a.promotion ?? null) === (b.promotion ?? null);
