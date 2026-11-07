import type { Color, PieceType } from '../engine';

// Filled glyphs are used for both colours and tinted with CSS. U+FE0E asks for
// the text (not emoji) presentation, which matters for the pawn on some systems.
export const GLYPH: Record<PieceType, string> = {
  k: '♚︎',
  q: '♛︎',
  r: '♜︎',
  b: '♝︎',
  n: '♞︎',
  p: '♟︎',
};

export const COLOR_NAME: Record<Color, string> = { w: 'White', b: 'Black' };
