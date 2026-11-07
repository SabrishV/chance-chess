// Messages exchanged between the browser and the GameRoom Durable Object.

import type { Action, Color, GameRules, GameView } from '../engine';

/** URL namespace for game rooms: /parties/game-room/<CODE>. Kebab-case of the `GameRoom` binding. */
export const PARTY = 'game-room';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/;

export type SeatChoice = Color | 'random';

export type ClientMessage =
  /** `token` is a random secret the browser keeps, so a player can reconnect to their seat. */
  /** `seat` and `rules` only matter for whoever opens a new room. */
  | { type: 'join'; token: string; name: string; seat?: SeatChoice; rules?: Partial<GameRules> }
  | { type: 'action'; action: Action }
  | { type: 'rematch' };

export interface PlayerInfo {
  name: string;
  connected: boolean;
}

export type ServerMessage =
  /** Your seat in this room; null means you are watching. */
  | { type: 'welcome'; color: Color | null }
  | {
      type: 'state';
      view: GameView;
      players: Record<Color, PlayerInfo | null>;
      rematch: Color[];
    }
  | { type: 'error'; message: string };

export function randomRoomCode(): string {
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
  return code;
}
