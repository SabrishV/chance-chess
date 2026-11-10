import { useEffect, useRef } from 'react';
import type { GameController } from './controllers';
import { sound } from './sound';

/** Play sound effects for whatever just happened in the game (never for the state we joined with). */
export function useGameSounds(game: GameController): void {
  const { view, myColors, mode } = game;
  const prev = useRef<{
    seq: number;
    logLength: number;
    note?: string;
    kept?: string;
    played?: string;
    over: boolean;
    myTurn: boolean;
  } | null>(null);

  useEffect(() => {
    if (!view) return;
    const last = view.log.at(-1);
    const myTurn = view.phase !== 'over' && myColors.includes(view.pos.turn);
    const now = {
      seq: view.seq,
      logLength: view.log.length,
      note: last?.note,
      kept: last?.kept,
      played: last?.played,
      over: !!view.result,
      myTurn,
    };
    const p = prev.current;
    prev.current = now;
    if (!p || now.seq === p.seq) return;

    // What happened on the board.
    const kinds = new Set(view.events.map((e) => e.kind));
    if (kinds.has('capture')) sound.play('capture');
    else if (kinds.has('teleport')) sound.play('teleport');
    else if (kinds.has('slide')) sound.play('move');
    if (kinds.has('swap')) sound.play('swap', kinds.has('slide') ? 0.15 : 0);

    // A card was drawn: the swish, then its sting as it flips face up. A
    // checkmate last-chance draw hovers face down to a heartbeat first.
    if (now.logLength > p.logLength && last) {
      sound.play('draw');
      if (last.lastChance) {
        [0.35, 0.95, 1.55].forEach((d) => sound.play('heartbeat', d));
        if (!view.result) sound.play('saved', 1.95);
      } else {
        sound.play(`card-${last.card}`, 0.42);
      }
    } else if (last?.played && last.played !== p.played) {
      sound.play(`card-${last.played}`);
    } else if (last?.kept && last.kept !== p.kept) {
      sound.play('draw');
    }
    if (last?.note?.startsWith('Check') && last.note !== p.note) sound.play('check', 0.15);

    if (view.result && !p.over) {
      const { winner } = view.result;
      const me = myColors.length === 1 ? myColors[0] : null;
      const delay = last?.lastChance ? 2.1 : 0.35;
      if (!winner) sound.play('draw-game', delay);
      else if (me) sound.play(winner === me ? 'win' : 'loss', delay);
      else sound.play(myColors.length === 2 ? 'win' : 'draw-game', delay);
    }

    // A gentle ping when it becomes your turn while this tab is in the background.
    if (mode === 'online' && now.myTurn && !p.myTurn && document.hidden) sound.play('turn', 0.3);
  }, [view, myColors, mode]);

  // Messages from the opponent.
  const chatCount = useRef<number | null>(null);
  useEffect(() => {
    const chat = game.chat;
    if (!chat) return;
    const before = chatCount.current;
    chatCount.current = chat.length;
    if (before !== null && chat.slice(before).some((m) => !myColors.includes(m.color))) sound.play('chat');
  }, [game.chat, myColors]);

  useEffect(() => {
    if (game.error) sound.play('error');
  }, [game.error]);
}
