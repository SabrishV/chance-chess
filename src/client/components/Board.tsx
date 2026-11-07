import type { Board as BoardArray, Color, Square } from '../../engine';
import { FILES, fileOf, rankOf, toSquare } from '../../engine';
import { GLYPH } from '../pieces';

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
  onSquareClick: (sq: Square) => void;
}

const TARGET_LABEL: Record<TargetKind, string> = {
  move: 'move here',
  capture: 'capture',
  teleport: 'teleport here',
  drop: 'swap in here',
};

export function Board({ board, orientation, selected, targets, movable, highlight, dangerKings, onSquareClick }: BoardProps) {
  const ranks = orientation === 'w' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const files = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div className="board" role="grid" aria-label="Chess board">
      {ranks.map((rank) =>
        files.map((file) => {
          const sq = toSquare(file, rank);
          const piece = board[sq];
          const target = targets.get(sq);
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
          const name = FILES[file] + (rank + 1);
          const label = `${name}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ''}${target ? `, ${TARGET_LABEL[target]}` : ''}`;

          return (
            <button key={sq} className={classes} onClick={() => onSquareClick(sq)} aria-label={label} type="button">
              {piece && <span className={`piece ${piece.color === 'w' ? 'white' : 'black'}`}>{GLYPH[piece.type]}</span>}
              {fileOf(sq) === files[0] && <span className="coord rank">{rankOf(sq) + 1}</span>}
              {rankOf(sq) === ranks[7] && <span className="coord file">{FILES[fileOf(sq)]}</span>}
              {target && <span className="marker" aria-hidden />}
            </button>
          );
        }),
      )}
    </div>
  );
}
