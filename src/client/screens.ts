import type { Color, GameRules } from '../engine';
import type { Difficulty } from '../engine/ai';
import { ROOM_CODE_PATTERN, type SeatChoice } from '../shared/protocol';

export type Screen =
  | { kind: 'home' }
  | { kind: 'local'; id: number; mode: 'ai' | 'local'; humanColor: Color; difficulty: Difficulty; rules: GameRules }
  | { kind: 'online'; code: string; seat?: SeatChoice; rules?: GameRules };

export function screenFromUrl(): Screen {
  // The home page is pre-rendered at build time, where there is no window.
  if (typeof window === 'undefined') return { kind: 'home' };
  const code = new URLSearchParams(window.location.search).get('room')?.toUpperCase();
  return code && ROOM_CODE_PATTERN.test(code) ? { kind: 'online', code } : { kind: 'home' };
}
