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
  | { type: 'rematch' }
  | { type: 'chat'; text: string };

export const CHAT_MAX_LENGTH = 200;

export interface ChatMessage {
  id: number;
  color: Color;
  name: string;
  text: string;
  /** Which game in this room (rematches count up), and how many turns had been logged when sent. */
  game: number;
  logLength: number;
}

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
      game: number;
      /** Server's Date.now(), so clients can line up the chess clocks. */
      serverNow: number;
    }
  /** Chat history on join (`replace`), then each new message. */
  | { type: 'chat'; messages: ChatMessage[]; replace: boolean }
  | { type: 'error'; message: string };

export function randomRoomCode(): string {
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
  return code;
}
