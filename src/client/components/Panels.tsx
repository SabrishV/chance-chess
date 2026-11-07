import {
  CARD_ORDER,
  CARDS,
  type Color,
  type GameView,
  type LegalActions,
  type PieceType,
  droppable,
} from '../../engine';
import type { PlayerInfo } from '../../shared/protocol';
import { COLOR_NAME, GLYPH } from '../pieces';
import { CardChip, CardFace } from './CardFace';

const PIECE_ORDER: PieceType[] = ['q', 'r', 'b', 'n', 'p'];

const sortPieces = (pieces: PieceType[]) =>
  [...pieces].sort((a, b) => PIECE_ORDER.indexOf(a) - PIECE_ORDER.indexOf(b));

export function PlayerBar({
  color,
  view,
  player,
  isYou,
}: {
  color: Color;
  view: GameView;
  player: PlayerInfo | null;
  isYou: boolean;
}) {
  const active = view.phase !== 'over' && view.pos.turn === color;
  const captured = sortPieces(view.inventory[color]);
  const lastCard = [...view.log].reverse().find((l) => l.color === color)?.card;

  return (
    <div className={`player-bar ${active ? 'active' : ''}`}>
      <span className={`color-dot ${color}`} aria-label={COLOR_NAME[color]} />
      <span className="player-name">
        {player ? player.name : <em>Waiting for player…</em>}
        {isYou && player && player.name !== 'You' && <span className="you"> (you)</span>}
      </span>
      {player && !player.connected && <span className="offline">offline</span>}
      <span className="captured" title="Captured pieces (usable with a Wild card)">
        {captured.map((t, i) => (
          <span key={i} className={`piece mini ${color === 'w' ? 'black' : 'white'}`}>
            {GLYPH[t]}
          </span>
        ))}
      </span>
      {lastCard && <CardChip card={lastCard} />}
    </div>
  );
}

function cardHint(view: GameView, legal: LegalActions, canDrop: boolean): string {
  switch (view.card) {
    case 'double':
      return view.movesMade === 0
        ? 'Make your first move. If it gives check, your turn ends there.'
        : 'Make a second move, or end your turn.';
    case 'wild':
      if (canDrop) return 'Pick a captured piece below, then one of your pawns to swap it in. Or just make a normal move.';
      return legal.moves.length
        ? 'Nothing to swap in yet (you need a captured piece and a pawn), so make a normal move.'
        : 'No moves available.';
    case 'teleport':
      return 'Pick a piece. Dots are normal moves; purple diamonds are teleport squares.';
    default:
      return 'Pick a piece, then a square.';
  }
}

export function CardPanel({
  view,
  canAct,
  legal,
  waitingFor,
  thinking,
  dropPiece,
  onDraw,
  onEndTurn,
  onPickDrop,
}: {
  view: GameView;
  canAct: boolean;
  legal: LegalActions;
  waitingFor: string;
  thinking: boolean;
  dropPiece: PieceType | null;
  onDraw: () => void;
  onEndTurn: () => void;
  onPickDrop: (p: PieceType | null) => void;
}) {
  const color = view.pos.turn;
  const deckLeft = Object.values(view.deckCounts[color]).reduce((a, b) => a + b, 0);

  if (canAct && view.phase === 'draw') {
    return (
      <div className="card-panel">
        <button className="deck" onClick={onDraw} type="button" autoFocus>
          <span className="deck-back" aria-hidden>
            ?
          </span>
          <span className="deck-label">Draw a card</span>
          <span className="deck-sub">{deckLeft} left in your deck · Space</span>
        </button>
      </div>
    );
  }

  if (canAct && view.phase === 'act' && view.card) {
    const droppablePieces = [...new Set(view.inventory[color].filter(droppable))];
    const canDrop = legal.drops.length > 0;
    return (
      <div className="card-panel">
        <CardFace card={view.card} />
        {view.card === 'double' && <div className="moves-left">Moves left: {view.movesLeft}</div>}
        <p className="hint">{cardHint(view, legal, canDrop)}</p>
        {canDrop && (
          <div className="drop-picker" role="group" aria-label="Captured pieces to swap in">
            {sortPieces(droppablePieces).map((t) => (
              <button
                key={t}
                type="button"
                className={`drop-piece ${dropPiece === t ? 'selected' : ''}`}
                onClick={() => onPickDrop(dropPiece === t ? null : t)}
                aria-pressed={dropPiece === t}
              >
                <span className={`piece ${color === 'w' ? 'white' : 'black'}`}>{GLYPH[t]}</span>
              </button>
            ))}
          </div>
        )}
        {legal.canEndTurn && (
          <button className="btn secondary" type="button" onClick={onEndTurn}>
            End turn
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card-panel waiting">
      {view.phase === 'act' && view.card ? <CardFace card={view.card} size="small" /> : <div className="deck-back idle">?</div>}
      <p className="hint">{thinking ? `${waitingFor} is thinking…` : waitingFor ? `${waitingFor}'s turn` : ''}</p>
    </div>
  );
}

export function GameLog({ view, names }: { view: GameView; names: Record<Color, string> }) {
  if (view.log.length === 0) return <p className="muted small">No moves yet.</p>;
  return (
    <ol className="log" reversed>
      {[...view.log].reverse().map((entry) => (
        <li key={entry.turn}>
          <span className="log-turn">{entry.turn}</span>
          <span className={`color-dot ${entry.color}`} title={names[entry.color]} />
          <CardChip card={entry.card} />
          <span className="log-text">
            {entry.actions.join(', ')}
            {entry.note && <em> {entry.note}</em>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function DeckCounts({ view, names }: { view: GameView; names: Record<Color, string> }) {
  return (
    <table className="deck-counts">
      <thead>
        <tr>
          <th>Card</th>
          <th>{names.w}</th>
          <th>{names.b}</th>
        </tr>
      </thead>
      <tbody>
        {CARD_ORDER.map((c) => (
          <tr key={c}>
            <td>
              <CardChip card={c} />
            </td>
            <td>{view.deckCounts.w[c]}</td>
            <td>{view.deckCounts.b[c]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RulesList() {
  return (
    <ul className="rules-cards">
      {CARD_ORDER.map((c) => (
        <li key={c}>
          <CardFace card={c} size="small" />
          <p>{CARDS[c].description}</p>
        </li>
      ))}
    </ul>
  );
}
