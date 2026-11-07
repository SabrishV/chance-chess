// Pop-ups drawn over the board: card reveals, banners, promotion and game over.

import { useMemo } from 'react';
import type { CardType, Color, PieceType } from '../../engine';
import { DealtCard } from './Cards';
import { PieceImg } from './Piece';

export interface Reveal {
  id: number;
  card: CardType;
  caption: string;
  note?: string;
  /** How long the reveal stays up, in ms. */
  duration: number;
}

/** A big card dealt face up over the board after every draw. */
export function CardReveal({ reveal }: { reveal: Reveal }) {
  return (
    <div className="reveal" key={reveal.id} aria-live="polite" style={{ animationDuration: `${reveal.duration}ms` }}>
      <div className="reveal-caption">{reveal.caption}</div>
      <DealtCard card={reveal.card} size="xl" stamp />
      {reveal.note && <div className="reveal-note">{reveal.note}</div>}
    </div>
  );
}

export function Banner({ id, text, tone }: { id: number; text: string; tone: 'danger' | 'info' }) {
  return (
    <div className={`banner banner-${tone}`} key={id} role="status">
      {text}
    </div>
  );
}

export function PromotionPicker({ color, onPick }: { color: Color; onPick: (t: PieceType) => void }) {
  return (
    <div className="promotion" role="dialog" aria-label="Choose a piece to promote to">
      <div className="promotion-title">Promote to</div>
      <div className="promotion-row">
        {(['q', 'r', 'b', 'n'] as PieceType[]).map((t) => (
          <button key={t} type="button" onClick={() => onPick(t)}>
            <PieceImg piece={{ type: t, color }} />
          </button>
        ))}
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ['#ff4fa3', '#ffd24a', '#43f0ff', '#7cf29c', '#a77bff', '#ff8a3d'];

export function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        duration: 2.2 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 220,
        spin: 360 + Math.random() * 720,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round: Math.random() < 0.35,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <i
          key={i}
          className={p.round ? 'round' : ''}
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              '--drift': `${p.drift}px`,
              '--spin': `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function GameOverModal({
  outcome,
  detail,
  rematchLabel,
  rematchDisabled,
  rematchNote,
  onRematch,
  onClose,
  onLeave,
}: {
  outcome: 'win' | 'loss' | 'draw' | 'neutral';
  detail: string;
  rematchLabel?: string;
  rematchDisabled?: boolean;
  rematchNote?: string;
  onRematch?: () => void;
  onClose: () => void;
  onLeave: () => void;
}) {
  const title = { win: 'Victory!', loss: 'Defeat', draw: 'Draw', neutral: 'Game over' }[outcome];
  return (
    <div className="gameover" role="dialog" aria-label={title}>
      {outcome === 'win' && <Confetti />}
      <div className={`gameover-card outcome-${outcome}`}>
        <div className="gameover-title">{title}</div>
        <p className="gameover-detail">{detail}</p>
        {rematchNote && <p className="small">{rematchNote}</p>}
        <div className="gameover-actions">
          {onRematch && (
            <button className="btn btn-primary" type="button" onClick={onRematch} disabled={rematchDisabled}>
              {rematchLabel ?? 'Rematch'}
            </button>
          )}
          <button className="btn btn-ghost" type="button" onClick={onLeave}>
            Main menu
          </button>
        </div>
        <button className="gameover-close" type="button" onClick={onClose} aria-label="Close and look at the board">
          ×
        </button>
      </div>
    </div>
  );
}
