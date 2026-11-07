import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
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
import { CHAT_MAX_LENGTH, type ChatMessage, type PlayerInfo } from '../../shared/protocol';
import { Card, CardChip, DealtCard, Deck } from './Cards';
import { ClockDisplay } from './Clock';
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
  clockOffset,
  tickWhenLow,
  bubble,
  bubbleBelow,
}: {
  color: Color;
  view: GameView;
  player: PlayerInfo | null;
  isYou: boolean;
  clockOffset: number;
  /** Tick audibly in the last seconds (for clocks this screen plays). */
  tickWhenLow?: boolean;
  /** A chat message to show as a speech bubble. */
  bubble?: { id: number; text: string };
  bubbleBelow?: boolean;
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
      <ClockDisplay view={view} color={color} offset={clockOffset} tickWhenLow={tickWhenLow} />
      {bubble && (
        <div key={bubble.id} className={`speech ${bubbleBelow ? 'below' : 'above'}`} role="status">
          {bubble.text}
        </div>
      )}
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

  // The big deck to draw from sits on the board; this is the reminder beside it.
  if (myTurn && view.phase === 'draw') {
    return (
      <div className="card-zone is-waiting">
        <button className="deck-button small" onClick={onDraw} type="button" disabled={!canAct} aria-label="Draw a card">
          <Deck count={deckSize(view, color)} size="md" />
        </button>
        <div className="zone-copy">
          <div className="zone-title">Draw a card!</div>
          <p className="zone-hint">Tap the deck on the board, or press Space.</p>
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

type TimelineItem = { kind: 'turn'; index: number } | { kind: 'chat'; message: ChatMessage };

const QUICK_CHAT = ['gg', 'Nice!', 'Oops 😅', 'Lucky!'];

/** Moves and (online) chat in one running list, oldest first. */
export function Timeline({
  view,
  names,
  chat,
  game,
  myColors,
  onSend,
}: {
  view: GameView;
  names: Record<Color, string>;
  chat: ChatMessage[] | null;
  game: number;
  myColors: Color[];
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Chat is placed after the turn that was last logged when it was sent.
  const items: TimelineItem[] = [];
  const messages = chat ?? [];
  for (const m of messages) if (m.game < game) items.push({ kind: 'chat', message: m });
  view.log.forEach((_, index) => {
    for (const m of messages) if (m.game === game && m.logLength === index) items.push({ kind: 'chat', message: m });
    items.push({ kind: 'turn', index });
  });
  for (const m of messages) if (m.game === game && m.logLength >= view.log.length) items.push({ kind: 'chat', message: m });

  const lastKey = `${view.log.length}:${view.log.at(-1)?.actions.length}:${messages.length}`;
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastKey]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    stickToBottom.current = true;
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
    setDraft('');
  };

  let content: ReactNode;
  if (items.length === 0) {
    content = <p className="muted small timeline-empty">{chat ? 'No moves yet. Say hi!' : 'No moves yet. Draw a card to begin!'}</p>;
  } else {
    content = items.map((item) => {
      if (item.kind === 'chat') {
        const m = item.message;
        const mine = myColors.includes(m.color);
        return (
          <div key={`c${m.id}`} className={`chat-row ${mine ? 'mine' : 'theirs'}`}>
            {!mine && <span className="chat-name">{m.name}</span>}
            <span className="chat-bubble">{m.text}</span>
          </div>
        );
      }
      const entry = view.log[item.index];
      return (
        <div key={`t${item.index}`} className="log-row">
          <span className="log-turn">{entry.turn}</span>
          <span className={`side-dot side-${entry.color}`} title={names[entry.color]} />
          <CardChip card={entry.card} />
          <span className="log-text">
            {entry.actions.join(', ')}
            {entry.note && <em> {entry.note}</em>}
          </span>
        </div>
      );
    });
  }

  return (
    <div className="timeline-wrap">
      <div
        className="timeline"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {content}
      </div>
      {chat && myColors.length > 0 && (
        <>
          <div className="quick-chat">
            {QUICK_CHAT.map((q) => (
              <button key={q} type="button" className="chip-btn" onClick={() => send(q)}>
                {q}
              </button>
            ))}
          </div>
          <form className="chat-form" onSubmit={submit}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={CHAT_MAX_LENGTH}
              placeholder="Message your opponent…"
              aria-label="Chat message"
            />
            <button className="btn btn-primary" type="submit" disabled={!draft.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </div>
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
