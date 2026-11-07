// Game controllers: one hook per way of playing, all exposing the same shape
// so the game screen doesn't care whether the opponent is local, AI or online.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PartySocket from 'partysocket';
import {
  type Action,
  type Color,
  type GameRules,
  type GameState,
  type GameView,
  applyAction,
  checkTimeout,
  newGame,
  opposite,
  startClock,
  toView,
} from '../engine';
import { DIFFICULTIES, type Difficulty } from '../engine/ai';
import {
  type ChatMessage,
  type ClientMessage,
  type PlayerInfo,
  type SeatChoice,
  type ServerMessage,
  PARTY,
} from '../shared/protocol';
import type { AiRequest, AiResponse } from './ai.worker';
import { playerToken } from './storage';

export interface GameController {
  mode: 'ai' | 'local' | 'online';
  view: GameView | null;
  /** Colours this screen may move for (both in pass & play, none when watching). */
  myColors: Color[];
  players: Record<Color, PlayerInfo | null>;
  /** The computer is choosing a move. */
  thinking: boolean;
  /** Online only: is the socket currently connected? */
  online: boolean;
  error: string | null;
  rematchRequested: Color[];
  /** Add to Date.now() to get the clock time the game state uses (server time online). */
  clockOffset: number;
  /** Which game in this room (online rematches count up). */
  game: number;
  /** Chat history, or null where there is no one to chat with. */
  chat: ChatMessage[] | null;
  send(action: Action): void;
  sendChat(text: string): void;
  rematch(): void;
}

function useFlashError(): [string | null, (msg: string) => void] {
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const flash = useCallback((msg: string) => {
    setError(msg);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setError(null), 3500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [error, flash];
}

// ---------------------------------------------------------------------------
// Local games: against the computer, or two people sharing one device.

export interface LocalOptions {
  mode: 'ai' | 'local';
  humanColor: Color;
  difficulty: Difficulty;
  rules: GameRules;
  playerName: string;
}

/**
 * Minimum time the computer takes per step, so people can follow it: your last
 * move finishes animating before it draws, and its card reveal finishes before it moves.
 */
const AI_DRAW_DELAY_MS = 1000;
const AI_FIRST_MOVE_DELAY_MS = 1900;
const AI_NEXT_MOVE_DELAY_MS = 1200;

const freshGame = (rules: GameRules) => startClock(newGame(Math.random, rules), Date.now());

export function useLocalGame(opts: LocalOptions): GameController {
  const [state, setState] = useState<GameState>(() => freshGame(opts.rules));
  const [human, setHuman] = useState(opts.humanColor);
  const [thinking, setThinking] = useState(false);
  const [error, flashError] = useFlashError();
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);

  const aiColor = opts.mode === 'ai' ? opposite(human) : null;
  const view = useMemo(() => toView(state), [state]);

  useEffect(() => {
    if (opts.mode !== 'ai') return;
    const worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [opts.mode]);

  // Let the computer take its turn, one action at a time.
  useEffect(() => {
    const worker = workerRef.current;
    if (!aiColor || !worker || state.phase === 'over' || state.pos.turn !== aiColor) return;

    const id = ++requestId.current;
    const started = Date.now();
    const minDelay =
      state.phase === 'draw' ? AI_DRAW_DELAY_MS : state.movesMade === 0 ? AI_FIRST_MOVE_DELAY_MS : AI_NEXT_MOVE_DELAY_MS;
    let timer: number | undefined;
    setThinking(true);

    const onMessage = (e: MessageEvent<AiResponse>) => {
      if (e.data.id !== id) return;
      timer = window.setTimeout(
        () => {
          const result = applyAction(state, e.data.action, aiColor);
          if (result.ok) setState(result.state);
          else console.error('Computer made an illegal action', e.data.action, result.error);
          setThinking(false);
        },
        Math.max(0, minDelay - (Date.now() - started)),
      );
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ id, view: toView(state), difficulty: opts.difficulty } satisfies AiRequest);

    return () => {
      worker.removeEventListener('message', onMessage);
      clearTimeout(timer);
      setThinking(false);
    };
  }, [state, aiColor, opts.difficulty]);

  // Flag the side to move the moment their time runs out.
  useEffect(() => {
    const clock = state.clock;
    if (!clock || clock.runningSince === null || state.phase === 'over') return;
    const msLeft = clock.runningSince + clock.remaining[state.pos.turn] - Date.now();
    const timer = window.setTimeout(() => setState((s) => checkTimeout(s, Date.now()) ?? s), Math.max(0, msLeft) + 20);
    return () => clearTimeout(timer);
  }, [state]);

  const send = useCallback(
    (action: Action) => {
      const actor = opts.mode === 'local' ? state.pos.turn : human;
      const result = applyAction(state, action, actor);
      if (result.ok) setState(result.state);
      else flashError(result.error);
    },
    [state, human, opts.mode, flashError],
  );

  const rematch = useCallback(() => {
    setState(freshGame(opts.rules));
    if (opts.mode === 'ai') setHuman((c) => opposite(c));
  }, [opts.mode, opts.rules]);

  const players: Record<Color, PlayerInfo> =
    opts.mode === 'ai'
      ? {
          [human]: { name: opts.playerName || 'You', connected: true },
          [opposite(human)]: { name: `Computer (${DIFFICULTIES[opts.difficulty].label})`, connected: true },
        } as Record<Color, PlayerInfo>
      : { w: { name: 'White', connected: true }, b: { name: 'Black', connected: true } };

  return {
    mode: opts.mode,
    view,
    myColors: opts.mode === 'ai' ? [human] : ['w', 'b'],
    players,
    thinking,
    online: true,
    error,
    rematchRequested: [],
    clockOffset: 0,
    game: 1,
    chat: null,
    send,
    sendChat: () => {},
    rematch,
  };
}

// ---------------------------------------------------------------------------
// Online games through the GameRoom Durable Object.

export interface OnlineOptions {
  code: string;
  playerName: string;
  /** Only used if this player is opening a brand-new room. */
  seat?: SeatChoice;
  rules?: GameRules;
}

export function useOnlineGame(opts: OnlineOptions): GameController {
  const [view, setView] = useState<GameView | null>(null);
  const [players, setPlayers] = useState<Record<Color, PlayerInfo | null>>({ w: null, b: null });
  const [rematchRequested, setRematchRequested] = useState<Color[]>([]);
  const [myColor, setMyColor] = useState<Color | null>(null);
  const [online, setOnline] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [game, setGame] = useState(1);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [error, flashError] = useFlashError();
  const socketRef = useRef<PartySocket | null>(null);
  const joinRef = useRef(opts);
  joinRef.current = opts;

  useEffect(() => {
    const socket = new PartySocket({
      host: window.location.host,
      protocol: window.location.protocol === 'https:' ? 'wss' : 'ws',
      party: PARTY,
      room: opts.code,
    });
    socketRef.current = socket;
    const sendMessage = (msg: ClientMessage) => socket.send(JSON.stringify(msg));

    // PartySocket reconnects automatically; re-joining claims the same seat.
    socket.addEventListener('open', () => {
      setOnline(true);
      const { playerName, seat, rules } = joinRef.current;
      sendMessage({ type: 'join', token: playerToken(), name: playerName, seat, rules });
    });
    socket.addEventListener('close', () => setOnline(false));
    socket.addEventListener('message', (e: MessageEvent<string>) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      if (msg.type === 'welcome') setMyColor(msg.color);
      else if (msg.type === 'state') {
        setView(msg.view);
        setPlayers(msg.players);
        setRematchRequested(msg.rematch);
        setGame(msg.game);
        setClockOffset(msg.serverNow - Date.now());
      } else if (msg.type === 'chat') {
        setChat((prev) => (msg.replace ? msg.messages : [...prev, ...msg.messages]));
      } else if (msg.type === 'error') flashError(msg.message);
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [opts.code, flashError]);

  const sendMessage = useCallback((msg: ClientMessage) => socketRef.current?.send(JSON.stringify(msg)), []);

  return {
    mode: 'online',
    view,
    myColors: myColor ? [myColor] : [],
    players,
    thinking: false,
    online,
    error,
    rematchRequested,
    clockOffset,
    game,
    chat,
    send: useCallback((action: Action) => sendMessage({ type: 'action', action }), [sendMessage]),
    sendChat: useCallback((text: string) => sendMessage({ type: 'chat', text }), [sendMessage]),
    rematch: useCallback(() => sendMessage({ type: 'rematch' }), [sendMessage]),
  };
}
