// Board representation and basic helpers.
// Squares are 0..63 where a1 = 0, b1 = 1, ..., h8 = 63 (index = rank * 8 + file).

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Square = number;

export interface Piece {
  readonly type: PieceType;
  readonly color: Color;
}

export type Board = (Piece | null)[];

export interface CastlingRights {
  w: { k: boolean; q: boolean };
  b: { k: boolean; q: boolean };
}

/** A pawn that just advanced two squares and can be captured en passant. */
export interface EnPassant {
  /** The square a capturing pawn moves to. */
  target: Square;
  /** The square of the pawn that would be captured. */
  pawn: Square;
  /** Color of the pawn that made the double step. */
  by: Color;
}

export interface Position {
  board: Board;
  turn: Color;
  castling: CastlingRights;
  ep: EnPassant | null;
}

export const FILES = 'abcdefgh';

export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const fileOf = (s: Square): number => s & 7;
export const rankOf = (s: Square): number => s >> 3;
export const toSquare = (file: number, rank: number): Square => rank * 8 + file;
export const onBoard = (file: number, rank: number): boolean =>
  file >= 0 && file < 8 && rank >= 0 && rank < 8;

export function squareName(s: Square): string {
  return FILES[fileOf(s)] + (rankOf(s) + 1);
}

export function parseSquare(name: string): Square {
  const file = FILES.indexOf(name[0]);
  const rank = Number(name[1]) - 1;
  if (name.length !== 2 || file < 0 || !onBoard(file, rank)) {
    throw new Error(`Bad square: ${name}`);
  }
  return toSquare(file, rank);
}

export const PIECE_LETTER: Record<PieceType, string> = {
  p: '',
  n: 'N',
  b: 'B',
  r: 'R',
  q: 'Q',
  k: 'K',
};

export const PIECE_NAME: Record<PieceType, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

const BACK_RANK: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

export function initialPosition(): Position {
  const board: Board = new Array(64).fill(null);
  for (let f = 0; f < 8; f++) {
    board[toSquare(f, 0)] = { type: BACK_RANK[f], color: 'w' };
    board[toSquare(f, 1)] = { type: 'p', color: 'w' };
    board[toSquare(f, 6)] = { type: 'p', color: 'b' };
    board[toSquare(f, 7)] = { type: BACK_RANK[f], color: 'b' };
  }
  return {
    board,
    turn: 'w',
    castling: { w: { k: true, q: true }, b: { k: true, q: true } },
    ep: null,
  };
}

/**
 * Build a position from a compact text diagram (rank 8 first, '.' for empty),
 * e.g. "4k3/8/8/8/8/8/8/4K3" in FEN piece-placement style. Handy for tests.
 */
export function positionFromFen(placement: string, turn: Color = 'w'): Position {
  const board: Board = new Array(64).fill(null);
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error('FEN placement needs 8 ranks');
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
      } else {
        const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
        board[toSquare(file, rank)] = { type: ch.toLowerCase() as PieceType, color };
        file++;
      }
    }
  });
  return {
    board,
    turn,
    castling: { w: { k: false, q: false }, b: { k: false, q: false } },
    ep: null,
  };
}

export function findKing(board: Board, color: Color): Square {
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (p && p.type === 'k' && p.color === color) return s;
  }
  return -1;
}

export function cloneCastling(c: CastlingRights): CastlingRights {
  return { w: { ...c.w }, b: { ...c.b } };
}
