// The Chance Chess card deck.

export type CardType = 'move' | 'double' | 'skip' | 'undo' | 'wild' | 'teleport';

export interface CardInfo {
  name: string;
  /** Big glyph shown on the card face. */
  symbol: string;
  description: string;
  tone: 'neutral' | 'good' | 'bad' | 'power';
}

export const CARDS: Record<CardType, CardInfo> = {
  move: {
    name: 'Move',
    symbol: '1',
    description: 'Make one normal move.',
    tone: 'neutral',
  },
  double: {
    name: 'Double Move',
    symbol: '2',
    description: 'Make two moves in a row. The second move is optional.',
    tone: 'good',
  },
  skip: {
    name: 'Skip',
    symbol: '0',
    description: 'You lose this turn.',
    tone: 'bad',
  },
  undo: {
    name: 'Undo',
    symbol: '−1',
    description: 'Your previous move is taken back, and you lose this turn.',
    tone: 'bad',
  },
  wild: {
    name: 'Wild Card',
    symbol: '★',
    description:
      'Swap one of your pawns for a piece you have captured. It joins your side. Or just make a normal move.',
    tone: 'power',
  },
  teleport: {
    name: 'Teleport',
    symbol: '⌖',
    description: 'Move any of your pieces to any empty square. Or just make a normal move.',
    tone: 'power',
  },
};

export const CARD_ORDER: CardType[] = ['move', 'double', 'skip', 'undo', 'wild', 'teleport'];

/**
 * Each player draws from their own 40-card deck, reshuffled when it runs out.
 * A deck (instead of an independent random roll each turn) keeps luck fair over
 * a game and lets players count cards: if you have seen 3 skips, 1 is left.
 */
export const DECK_COMPOSITION: Record<CardType, number> = {
  move: 20,
  double: 5,
  skip: 4,
  undo: 3,
  wild: 5,
  teleport: 3,
};

export type Rng = () => number;

export function shuffledDeck(rng: Rng): CardType[] {
  const deck: CardType[] = [];
  for (const type of CARD_ORDER) {
    for (let i = 0; i < DECK_COMPOSITION[type]; i++) deck.push(type);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function countCards(deck: readonly CardType[]): Record<CardType, number> {
  const counts = { move: 0, double: 0, skip: 0, undo: 0, wild: 0, teleport: 0 };
  for (const card of deck) counts[card]++;
  return counts;
}
