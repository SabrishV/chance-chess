import { useEffect, useRef, useState } from 'react';
import { type Color, type GameView, timeLeft } from '../../engine';
import { sound } from '../sound';

/** Under this much time the clock turns red and shows tenths. */
const LOW_TIME_MS = 20_000;
/** Under this much time your own clock ticks every second. */
const TICK_TIME_MS = 10_000;

function formatTime(ms: number): string {
  if (ms < LOW_TIME_MS) {
    const tenths = Math.floor(ms / 100);
    return `0:${String(Math.floor(tenths / 10)).padStart(2, '0')}.${tenths % 10}`;
  }
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** One player's chess clock. `offset` lines this browser's time up with the game's. */
export function ClockDisplay({
  view,
  color,
  offset,
  tickWhenLow = false,
}: {
  view: GameView;
  color: Color;
  offset: number;
  tickWhenLow?: boolean;
}) {
  const clock = view.clock;
  const running = !!clock && clock.runningSince !== null && view.pos.turn === color && view.phase !== 'over';
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);

  const ms = clock ? timeLeft(view, color, (running ? now : Date.now()) + offset) : Infinity;

  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    const second = Math.ceil(ms / 1000);
    if (!running || !tickWhenLow || ms <= 0 || ms >= TICK_TIME_MS || second === lastTick.current) return;
    lastTick.current = second;
    sound.play('tick');
  }, [ms, running, tickWhenLow]);

  if (!clock) return null;
  const classes = ['clock', running && 'running', ms < LOW_TIME_MS && 'low', ms === 0 && 'out'].filter(Boolean).join(' ');
  return (
    <span className={classes} role="timer" aria-label={`${formatTime(ms)} left`}>
      {formatTime(ms)}
    </span>
  );
}
