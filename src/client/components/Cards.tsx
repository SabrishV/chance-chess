// Card artwork: faces, backs and the animated "deal & flip".

import type { CSSProperties, ReactNode } from 'react';
import { CARDS, type CardType } from '../../engine';

interface CardArt {
  /** Gradient colours of the card face. */
  from: string;
  to: string;
  rarity: 'Common' | 'Rare' | 'Epic' | 'Cursed';
  /** Word stamped over the card when it's played. */
  stamp?: string;
  icon: ReactNode;
}

export const CARD_ART: Record<CardType, CardArt> = {
  move: {
    from: '#5ab8ff',
    to: '#2f4fd8',
    rarity: 'Common',
    icon: <path d="M12 20V4M5 11l7-7 7 7" />,
  },
  double: {
    from: '#6ff29a',
    to: '#0d8f63',
    rarity: 'Rare',
    stamp: '×2',
    icon: <path d="M5 13l7-7 7 7M5 20l7-7 7 7" />,
  },
  skip: {
    from: '#ff7d8e',
    to: '#a3123f',
    rarity: 'Cursed',
    stamp: 'Skipped!',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M6 6l12 12" />
      </>
    ),
  },
  undo: {
    from: '#ffc15c',
    to: '#d4480f',
    rarity: 'Cursed',
    stamp: 'Rewind!',
    icon: <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  },
  wild: {
    from: '#ff6bd6',
    to: '#7b4dff',
    rarity: 'Epic',
    icon: <path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9L12 2.8z" />,
  },
  teleport: {
    from: '#43f0ff',
    to: '#6a35e8',
    rarity: 'Epic',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" strokeDasharray="4 3" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      </>
    ),
  },
};

export type CardSize = 'xl' | 'lg' | 'md' | 'sm';

function CardIcon({ card }: { card: CardType }) {
  return (
    <svg className="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {CARD_ART[card].icon}
    </svg>
  );
}

const cardStyle = (card: CardType) => ({ '--c1': CARD_ART[card].from, '--c2': CARD_ART[card].to }) as CSSProperties;

/** The face of a card. Larger sizes include the rules text. */
export function Card({ card, size = 'lg' }: { card: CardType; size?: CardSize }) {
  const info = CARDS[card];
  const art = CARD_ART[card];
  const detailed = size === 'lg' || size === 'xl';
  return (
    <div className={`card card-${card} size-${size}`} style={cardStyle(card)} role="img" aria-label={`${info.name} card`}>
      <span className="card-corner tl">{info.symbol}</span>
      <span className="card-corner br">{info.symbol}</span>
      <div className="card-art">
        <CardIcon card={card} />
      </div>
      <div className="card-title">{info.name}</div>
      {detailed && <div className="card-text">{info.description}</div>}
      {detailed && <div className={`card-rarity rarity-${art.rarity.toLowerCase()}`}>◆ {art.rarity}</div>}
    </div>
  );
}

export function CardBack({ size = 'lg' }: { size?: CardSize }) {
  return (
    <div className={`card card-back size-${size}`} aria-hidden>
      <div className="back-emblem">
        <img src="/pieces/wN.svg" alt="" draggable={false} />
      </div>
    </div>
  );
}

/**
 * A card that is dealt from the deck and flips face up. Give it a new `key`
 * for every draw so the animation plays again.
 */
export function DealtCard({ card, size = 'lg', stamp = false }: { card: CardType; size?: CardSize; stamp?: boolean }) {
  const art = CARD_ART[card];
  return (
    <div className={`dealt size-${size} fx-${card}`}>
      <div className="dealt-inner">
        <div className="dealt-face">
          <Card card={card} size={size} />
        </div>
        <div className="dealt-face dealt-back">
          <CardBack size={size} />
        </div>
      </div>
      {stamp && art.stamp && <div className="card-stamp">{art.stamp}</div>}
    </div>
  );
}

/** A small deck of face-down cards with a count badge. */
export function Deck({ count, size = 'lg' }: { count: number; size?: CardSize }) {
  return (
    <div className={`deck-stack size-${size}`}>
      <CardBack size={size} />
      <CardBack size={size} />
      <CardBack size={size} />
      <span className="deck-count" aria-label={`${count} cards left`}>
        {count}
      </span>
    </div>
  );
}

export function CardChip({ card }: { card: CardType }) {
  return (
    <span className={`card-chip card-${card}`} style={cardStyle(card)}>
      <b>{CARDS[card].symbol}</b>
      {CARDS[card].name}
    </span>
  );
}
