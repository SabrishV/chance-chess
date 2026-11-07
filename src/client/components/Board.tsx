import { type CSSProperties, useMemo } from 'react';
import {
  type BoardEvent,
  type Board as BoardArray,
  type Color,
  type Piece,
  type Square,
  FILES,
  fileOf,
  rankOf,
  toSquare,
} from '../../engine';
import { PieceImg, pieceLabel } from './Piece';

export type TargetKind = 'move' | 'capture' | 'teleport' | 'drop';

interface BoardProps {
  board: BoardArray;
  orientation: Color;
  selected: Square | null;
  targets: Map<Square, TargetKind>;
  /** Squares holding pieces the player can act with right now. */
  movable: Set<Square>;
  highlight: Square[];
  dangerKings: Square[];
  events: BoardEvent[];
  /** Changes whenever `events` are new; 0 disables animation (e.g. on first load). */
  animKey: number;
  onSquareClick: (sq: Square) => void;
}

const TARGET_LABEL: Record<TargetKind, string> = {
  move: 'move here',
  capture: 'capture',
  teleport: 'teleport here',
  drop: 'swap in here',
};

interface Anim {
  className: string;
  style?: CSSProperties;
}

interface Effects {
  pieces: Map<Square, Anim>;
  ghosts: Map<Square, { piece: Piece; className: string }[]>;
  bursts: Map<Square, string>;
}

const NO_EFFECTS: Effects = { pieces: new Map(), ghosts: new Map(), bursts: new Map() };

/** Turn engine events into per-square CSS animations. */
function planEffects(events: BoardEvent[], orientation: Color): Effects {
  const col = (s: Square) => (orientation === 'w' ? fileOf(s) : 7 - fileOf(s));
  const row = (s: Square) => (orientation === 'w' ? 7 - rankOf(s) : rankOf(s));
  const fx: Effects = { pieces: new Map(), ghosts: new Map(), bursts: new Map() };
  const ghost = (s: Square, piece: Piece, className: string) =>
    fx.ghosts.set(s, [...(fx.ghosts.get(s) ?? []), { piece, className }]);

  for (const e of events) {
    switch (e.kind) {
      case 'slide':
        fx.pieces.set(e.to, {
          className: 'anim-slide',
          style: { '--dx': `${(col(e.from) - col(e.to)) * 100}%`, '--dy': `${(row(e.from) - row(e.to)) * 100}%` } as CSSProperties,
        });
        break;
      case 'capture':
        ghost(e.square, e.piece, 'ghost-capture');
        fx.bursts.set(e.square, e.piece.type === 'k' ? 'burst burst-big' : 'burst');
        break;
      case 'teleport':
        ghost(e.from, e.piece, 'ghost-vanish');
        fx.pieces.set(e.to, { className: 'anim-materialize' });
        fx.bursts.set(e.from, 'portal');
        fx.bursts.set(e.to, 'portal');
        break;
      case 'swap':
        if (!fx.pieces.has(e.square)) {
          ghost(e.square, e.before, 'ghost-swap');
          fx.pieces.set(e.square, { className: 'anim-swap' });
        }
        fx.bursts.set(e.square, 'burst sparkle');
        break;
      case 'appear':
        fx.pieces.set(e.square, { className: 'anim-appear' });
        break;
    }
  }
  return fx;
}

const PARTICLES = Array.from({ length: 10 }, (_, i) => i);

export function Board(props: BoardProps) {
  const { board, orientation, selected, targets, movable, highlight, dangerKings, events, animKey, onSquareClick } = props;
  const fx = useMemo(() => (animKey ? planEffects(events, orientation) : NO_EFFECTS), [events, orientation, animKey]);

  const ranks = orientation === 'w' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const files = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div className="board" role="grid" aria-label="Chess board">
      {ranks.map((rank) =>
        files.map((file) => {
          const sq = toSquare(file, rank);
          const piece = board[sq];
          const target = targets.get(sq);
          const anim = fx.pieces.get(sq);
          const burst = fx.bursts.get(sq);
          const classes = [
            'square',
            (file + rank) % 2 === 0 ? 'dark' : 'light',
            highlight.includes(sq) && 'last',
            selected === sq && 'selected',
            movable.has(sq) && 'movable',
            dangerKings.includes(sq) && 'danger',
            target && `target-${target}`,
          ]
            .filter(Boolean)
            .join(' ');
          const label = `${FILES[file]}${rank + 1}${piece ? `, ${pieceLabel(piece)}` : ''}${target ? `, ${TARGET_LABEL[target]}` : ''}`;

          return (
            <button key={sq} className={classes} onClick={() => onSquareClick(sq)} aria-label={label} type="button">
              {file === files[0] && <span className="coord rank">{rank + 1}</span>}
              {rank === ranks[7] && <span className="coord file">{FILES[file]}</span>}
              {fx.ghosts.get(sq)?.map((g, i) => (
                <PieceImg key={`g${animKey}-${i}`} piece={g.piece} className={`ghost ${g.className}`} alt="" />
              ))}
              {piece && (
                <PieceImg
                  key={anim ? `p${animKey}` : 'p'}
                  piece={piece}
                  className={anim?.className}
                  style={anim?.style}
                  alt=""
                />
              )}
              {burst && (
                <span key={`b${animKey}`} className={burst} aria-hidden>
                  {PARTICLES.map((i) => (
                    <i key={i} />
                  ))}
                </span>
              )}
              {target && <span className="marker" aria-hidden />}
            </button>
          );
        }),
      )}
    </div>
  );
}
