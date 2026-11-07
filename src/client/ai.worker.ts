// Runs the computer opponent off the main thread so the page stays responsive.

import { chooseAction, type Difficulty } from '../engine/ai';
import type { GameView } from '../engine';

export interface AiRequest {
  id: number;
  view: GameView;
  difficulty: Difficulty;
}

export interface AiResponse {
  id: number;
  action: ReturnType<typeof chooseAction>;
}

const ctx = self as unknown as {
  onmessage: (e: MessageEvent<AiRequest>) => void;
  postMessage: (msg: AiResponse) => void;
};

ctx.onmessage = (e) => {
  const { id, view, difficulty } = e.data;
  ctx.postMessage({ id, action: chooseAction(view, difficulty) });
};
