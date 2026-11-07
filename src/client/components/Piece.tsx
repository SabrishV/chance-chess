import type { CSSProperties } from 'react';
import type { Color, Piece as PieceData, PieceType } from '../../engine';

export const COLOR_NAME: Record<Color, string> = { w: 'White', b: 'Black' };

const TYPE_NAME: Record<PieceType, string> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};

/** Piece artwork lives in public/pieces ("celtic" set by Maurizio Monge, MIT). */
export const pieceSrc = (p: PieceData): string => `/pieces/${p.color}${p.type.toUpperCase()}.svg`;

export const pieceLabel = (p: PieceData): string => `${COLOR_NAME[p.color].toLowerCase()} ${TYPE_NAME[p.type]}`;

interface PieceImgProps {
  piece: PieceData;
  className?: string;
  style?: CSSProperties;
  /** Defaults to a description like "white knight"; pass "" when a parent already labels it. */
  alt?: string;
}

export function PieceImg({ piece, className = '', style, alt }: PieceImgProps) {
  return (
    <img
      className={`piece-img ${className}`}
      src={pieceSrc(piece)}
      alt={alt ?? pieceLabel(piece)}
      draggable={false}
      style={style}
    />
  );
}
