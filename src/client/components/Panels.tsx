import {
  CARD_ORDER,
  CARDS,
  DECK_COMPOSITION,
  type Color,
  type GameView,
  type LegalActions,
  type PieceType,
  droppable,
} from '../../engine';
import type { PlayerInfo } from '../../shared/protocol';
import { Card, CardChip, DealtCard, Deck } from './Cards';
import { COLOR_NAME, PieceImg } from './Piece';

const PIECE_ORDER: PieceType[] = ['q', 'r', 'b', 'n', 'p'];

const sortPieces = (pieces: PieceType[]) =>
  [...pieces].sort((a, b) => PIECE_ORDER.indexOf(a) - PIECE_ORDER.indexOf(b));

const deckSize = (view: GameView, c: Color) => Object.values(view.deckCounts[c]).reduce((a, b) => a + b, 0);

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
  const enemy: Color = color === 'w' ? 'b' : 'w';

  return (
    <div className={`player-bar ${active ? 'active' : ''}`}>
      <div className={`avatar avatar-${color}`}>
        <PieceImg piece={{ type: 'k', color }} alt={COLOR_NAME[color]} />
      </div>
      <div className="player-info">
        <div className="player-name">
          {player ? player.name : <em className="muted">Waiting for player…</em>}
          {isYou && player && <span className="tag">You</span>}
        </div>
        <div className="player-sub">
          {player && !player.connected ? <span className="offline">● offline</span> : active ? <span className="turn-dot">● to play</span> : COLOR_NAME[color]}
        </div>
      </div>
      <div className="tray" title="Captured pieces: a Wild card can bring these back on your side">
        {captured.map((t, i) => (
          <PieceImg key={i} piece={{ type: t, color: enemy }} className="tray-piece" />
        ))}
      </div>
    </div>
  );
}

function cardHint(view: GameView, legal: LegalActions): string {
  switch (view.card) {
    case 'double':
      return view.movesMade === 0
        ? 'Make your first move. Giving check ends the turn.'
        : 'Make a second move, or end your turn.';
    case 'wild':
      if (legal.drops.length) return 'Tap a captured piece below, then one of your pawns to swap it in. Or just move.';
      return 'Nothing to swap in yet (you need a captured piece and a pawn), so make a normal move.';
    case 'teleport':
      return 'Pick a piece. Dots are normal moves; glowing portals are teleport squares.';
    default:
      return 'Pick a piece, then where it goes.';
  }
}

interface CardZoneProps {
  view: GameView;
  /** True when this screen controls the side to move. */
  myTurn: boolean;
  canAct: boolean;
  legal: LegalActions;
  turnName: string;
  thinking: boolean;
  dropPiece: PieceType | null;
  onDraw: () => void;
  onEndTurn: () => void;
  onPickDrop: (p: PieceType | null) => void;
}

/** The deck, the card in play and what to do with it. */
export function CardZone(props: CardZoneProps) {
  const { view, myTurn, canAct, legal, turnName, thinking, dropPiece, onDraw, onEndTurn, onPickDrop } = props;
  const color = view.pos.turn;
  const dealKey = view.log.length;

  if (myTurn && view.phase === 'draw') {
    return (
      <div className="card-zone is-draw">
        <button className="deck-button" onClick={onDraw} type="button" disabled={!canAct} aria-label="Draw a card">
          <Deck count={deckSize(view, color)} size="lg" />
        </button>
        <div className="zone-copy">
          <div className="zone-title">Draw a card!</div>
          <p className="zone-hint">Tap the deck or press Space.</p>
          <button className="btn btn-primary btn-pulse" onClick={onDraw} type="button" disabled={!canAct}>
            Draw
          </button>
        </div>
      </div>
    );
  }

  if (myTurn && view.phase === 'act' && view.card) {
    const pieces = sortPieces([...new Set(view.inventory[color].filter(droppable))]);
    return (
      <div className="card-zone is-act">
        <DealtCard key={dealKey} card={view.card} size="lg" />
        <div className="zone-copy">
          <div className="zone-title">{CARDS[view.card].name}</div>
          {view.card === 'double' && (
            <div className="pips" aria-label={`${view.movesLeft} moves left`}>
              {[0, 1].map((i) => (
                <span key={i} className={i < view.movesMade ? 'pip used' : 'pip'} />
              ))}
            </div>
          )}
          <p className="zone-hint">{cardHint(view, legal)}</p>
          {legal.drops.length > 0 && (
            <div className="drop-picker" role="group" aria-label="Captured pieces to swap in">
              {pieces.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`drop-piece ${dropPiece === t ? 'selected' : ''}`}
                  onClick={() => onPickDrop(dropPiece === t ? null : t)}
                  aria-pressed={dropPiece === t}
                >
                  <PieceImg piece={{ type: t, color }} />
                </button>
              ))}
            </div>
          )}
          {legal.canEndTurn && (
            <button className="btn btn-ghost" type="button" onClick={onEndTurn}>
              End turn
            </button>
          )}
        </div>
      </div>
    );
  }

  // Watching the other side's turn.
  return (
    <div className="card-zone is-waiting">
      {view.phase === 'act' && view.card ? (
        <DealtCard key={dealKey} card={view.card} size="md" />
      ) : (
        <Deck count={deckSize(view, color)} size="md" />
      )}
      <div className="zone-copy">
        <div className="zone-title">
          {view.phase === 'act' && view.card ? `${turnName} drew ${CARDS[view.card].name}` : `${turnName} is drawing`}
        </div>
        <p className="zone-hint">
          {thinking ? 'Thinking' : 'Waiting'}
          <span className="dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </p>
      </div>
    </div>
  );
}

export function GameLog({ view, names }: { view: GameView; names: Record<Color, string> }) {
  if (view.log.length === 0) return <p className="muted small">No moves yet. Draw a card to begin!</p>;
  return (
    <ol className="log">
      {[...view.log].reverse().map((entry) => (
        <li key={entry.turn}>
          <span className="log-turn">{entry.turn}</span>
          <span className={`side-dot side-${entry.color}`} title={names[entry.color]} />
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

/** Remaining cards in each deck, for card counting. */
export function CardCounter({ view, names }: { view: GameView; names: Record<Color, string> }) {
  return (
    <div className="counter">
      <div className="counter-head">
        <span />
        <span>{names.w}</span>
        <span>{names.b}</span>
      </div>
      {CARD_ORDER.map((c) => (
        <div className="counter-row" key={c}>
          <CardChip card={c} />
          {(['w', 'b'] as Color[]).map((side) => (
            <span className="counter-cell" key={side}>
              <span className="bar">
                <span className={`bar-fill card-${c}`} style={{ width: `${(view.deckCounts[side][c] / DECK_COMPOSITION[c]) * 100}%` }} />
              </span>
              <b>{view.deckCounts[side][c]}</b>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardGallery() {
  return (
    <ul className="gallery">
      {CARD_ORDER.map((c) => (
        <li key={c}>
          <Card card={c} size="lg" />
          <p>
            <b>{DECK_COMPOSITION[c]}</b> in each deck
          </p>
        </li>
      ))}
    </ul>
  );
}
