import { CARDS, type CardType } from '../../engine';

export function CardFace({ card, size = 'large' }: { card: CardType; size?: 'large' | 'small' }) {
  const info = CARDS[card];
  return (
    <div className={`card-face tone-${info.tone} ${size}`} key={card}>
      <span className="card-symbol">{info.symbol}</span>
      <span className="card-name">{info.name}</span>
      {size === 'large' && <span className="card-desc">{info.description}</span>}
    </div>
  );
}

export function CardChip({ card }: { card: CardType }) {
  const info = CARDS[card];
  return (
    <span className={`card-chip tone-${info.tone}`}>
      <b>{info.symbol}</b> {info.name}
    </span>
  );
}
