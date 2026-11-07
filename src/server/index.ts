// Cloudflare Worker for online games. Each room code maps to one GameRoom
// Durable Object, which holds the authoritative game state, draws the cards
// (so clients can't cheat), runs the chess clocks, relays chat, and broadcasts
// every change to the players.

import { type Connection, Server, routePartykitRequest } from 'partyserver';
import {
  type Action,
  type Color,
  type GameRules,
  type GameState,
  type TimeControl,
  DEFAULT_RULES,
  applyAction,
  checkTimeout,
  newGame,
  opposite,
  startClock,
  toView,
} from '../engine';
import {
  type ChatMessage,
  type ClientMessage,
  type PlayerInfo,
  type ServerMessage,
  CHAT_MAX_LENGTH,
  ROOM_CODE_PATTERN,
} from '../shared/protocol';

interface Env {
  GameRoom: DurableObjectNamespace<GameRoom>;
  /** Comma-separated website origins allowed to open game rooms; empty allows any. */
  ALLOWED_ORIGINS?: string;
}

interface Seat {
  token: string;
  name: string;
}

interface RoomData {
  state: GameState;
  seats: Record<Color, Seat | null>;
  /** Players who asked for a rematch after the game ended. */
  rematch: Color[];
  /** Seat preference of whoever opened the room. */
  creatorSeat: Color | null;
  /** Counts games played in this room (rematches). */
  game: number;
  chat: ChatMessage[];
  lastActivity: number;
}

interface ConnState {
  token: string;
  color: Color | null;
}

/** Rooms with no activity for this long are deleted. */
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const CHAT_HISTORY = 100;
const CHAT_MIN_INTERVAL_MS = 400;

const cleanName = (name: unknown): string =>
  (typeof name === 'string' ? name.trim().slice(0, 20) : '') || 'Player';

/** Accept only sensible clocks: 30 seconds to an hour, up to a minute of increment. */
function cleanTimeControl(tc: unknown): TimeControl | null {
  if (!tc || typeof tc !== 'object') return null;
  const { initialMs, incrementMs } = tc as Record<string, unknown>;
  if (typeof initialMs !== 'number' || typeof incrementMs !== 'number') return null;
  if (initialMs < 30_000 || initialMs > 3_600_000 || incrementMs < 0 || incrementMs > 60_000) return null;
  return { initialMs, incrementMs };
}

export class GameRoom extends Server<Env> {
  // Hibernation lets Cloudflare evict the object between messages; state is
  // reloaded from storage in onStart() when it wakes up.
  static options = { hibernate: true };

  private room: RoomData | null = null;
  private lastChat = new Map<string, number>();

  async onStart(): Promise<void> {
    this.room = (await this.ctx.storage.get<RoomData>('room')) ?? null;
    // Rooms saved by older versions lack the newer fields.
    if (this.room) {
      this.room.game ??= 1;
      this.room.chat ??= [];
      this.room.lastActivity ??= Date.now();
      this.room.state.clock ??= null;
    }
  }

  async onMessage(conn: Connection<ConnState>, raw: string | ArrayBuffer | ArrayBufferView): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(conn, { type: 'error', message: 'Bad message.' });
    }

    switch (msg.type) {
      case 'join':
        return this.join(conn, msg);
      case 'action':
        return this.act(conn, msg.action);
      case 'rematch':
        return this.requestRematch(conn);
      case 'chat':
        return this.chat(conn, msg.text);
    }
  }

  onClose(conn: Connection<ConnState>): void {
    this.lastChat.delete(conn.id);
    if (this.room) this.broadcastState(conn.id);
  }

  /** One alarm serves two jobs: a player's flag falling, and deleting idle rooms. */
  async onAlarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const now = Date.now();

    const timedOut = checkTimeout(room.state, now);
    if (timedOut) {
      room.state = timedOut;
      await this.save(false);
      this.broadcastState();
    } else if (now >= room.lastActivity + ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    await this.scheduleAlarm();
  }

  private async join(conn: Connection<ConnState>, { token, name, seat, rules }: ClientMessage & { type: 'join' }) {
    if (typeof token !== 'string' || token.length < 16) {
      return this.send(conn, { type: 'error', message: 'Bad join request.' });
    }

    if (!this.room) {
      const creatorSeat: Color = seat === 'w' || seat === 'b' ? seat : Math.random() < 0.5 ? 'w' : 'b';
      const gameRules: GameRules = {
        checkEndsDoubleMove: rules?.checkEndsDoubleMove ?? DEFAULT_RULES.checkEndsDoubleMove,
        timeControl: cleanTimeControl(rules?.timeControl),
      };
      this.room = {
        state: newGame(Math.random, gameRules),
        seats: { w: null, b: null },
        rematch: [],
        creatorSeat,
        game: 1,
        chat: [],
        lastActivity: Date.now(),
      };
    }
    const room = this.room;
    const { seats } = room;

    let color: Color | null = (['w', 'b'] as const).find((c) => seats[c]?.token === token) ?? null;
    if (!color) {
      // First player gets their preferred seat; the next player takes the other one.
      const preferred = room.creatorSeat ?? 'w';
      color = !seats[preferred] ? preferred : !seats[opposite(preferred)] ? opposite(preferred) : null;
      if (color) seats[color] = { token, name: cleanName(name) };
    } else {
      seats[color]!.name = cleanName(name);
    }

    // The clock starts once both players are here.
    if (seats.w && seats.b) room.state = startClock(room.state, Date.now());

    conn.setState({ token, color });
    this.send(conn, { type: 'welcome', color });
    this.send(conn, { type: 'chat', messages: room.chat, replace: true });
    await this.save();
    this.broadcastState();
  }

  private async act(conn: Connection<ConnState>, action: Action) {
    const room = this.room;
    const color = conn.state?.color;
    if (!room || !color) return this.send(conn, { type: 'error', message: "You're watching this game." });
    if (!room.seats.w || !room.seats.b) {
      return this.send(conn, { type: 'error', message: 'Waiting for an opponent to join.' });
    }
    if (!action || typeof action !== 'object') return this.send(conn, { type: 'error', message: 'Bad action.' });

    const result = applyAction(room.state, action, color, Math.random, Date.now());
    if (!result.ok) return this.send(conn, { type: 'error', message: result.error });

    room.state = result.state;
    await this.save();
    this.broadcastState();
  }

  private async chat(conn: Connection<ConnState>, text: unknown) {
    const room = this.room;
    const color = conn.state?.color;
    if (!room || !color) return this.send(conn, { type: 'error', message: 'Only players can chat.' });
    const clean = typeof text === 'string' ? text.trim().slice(0, CHAT_MAX_LENGTH) : '';
    if (!clean) return;

    const now = Date.now();
    if (now - (this.lastChat.get(conn.id) ?? 0) < CHAT_MIN_INTERVAL_MS) {
      return this.send(conn, { type: 'error', message: 'Slow down a little.' });
    }
    this.lastChat.set(conn.id, now);

    const message: ChatMessage = {
      id: (room.chat.at(-1)?.id ?? 0) + 1,
      color,
      name: room.seats[color]!.name,
      text: clean,
      game: room.game,
      logLength: room.state.log.length,
    };
    room.chat = [...room.chat, message].slice(-CHAT_HISTORY);
    await this.save();
    this.broadcast(JSON.stringify({ type: 'chat', messages: [message], replace: false } satisfies ServerMessage));
  }

  private async requestRematch(conn: Connection<ConnState>) {
    const room = this.room;
    const color = conn.state?.color;
    if (!room || !color || room.state.phase !== 'over') return;
    if (!room.rematch.includes(color)) room.rematch.push(color);

    if (room.rematch.length === 2) {
      // New game with colours swapped.
      room.state = startClock(newGame(Math.random, room.state.rules), Date.now());
      room.seats = { w: room.seats.b, b: room.seats.w };
      room.rematch = [];
      room.game++;
      for (const c of this.getConnections<ConnState>()) {
        if (!c.state?.color) continue;
        const swapped = opposite(c.state.color);
        c.setState({ token: c.state.token, color: swapped });
        this.send(c, { type: 'welcome', color: swapped });
      }
    }
    await this.save();
    this.broadcastState();
  }

  private async save(activity = true) {
    if (activity) this.room!.lastActivity = Date.now();
    await this.ctx.storage.put('room', this.room);
    await this.scheduleAlarm();
  }

  /** Wake up when the side to move would run out of time, or when the room expires. */
  private async scheduleAlarm() {
    const room = this.room!;
    let at = room.lastActivity + ROOM_TTL_MS;
    const clock = room.state.clock;
    if (clock?.runningSince != null && room.state.phase !== 'over') {
      at = Math.min(at, clock.runningSince + clock.remaining[room.state.pos.turn]);
    }
    await this.ctx.storage.setAlarm(at);
  }

  private send(conn: Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  /** Send the public game view to everyone. `closingId` is a connection that is going away. */
  private broadcastState(closingId?: string) {
    const room = this.room!;
    const online = new Set<Color>();
    for (const c of this.getConnections<ConnState>()) {
      if (c.id !== closingId && c.state?.color) online.add(c.state.color);
    }
    const info = (c: Color): PlayerInfo | null =>
      room.seats[c] ? { name: room.seats[c]!.name, connected: online.has(c) } : null;

    const msg: ServerMessage = {
      type: 'state',
      view: toView(room.state),
      players: { w: info('w'), b: info('b') },
      rematch: room.rematch,
      game: room.game,
      serverNow: Date.now(),
    };
    this.broadcast(JSON.stringify(msg), closingId ? [closingId] : []);
  }
}

/**
 * Only our own website may open game rooms, so other sites can't build on top
 * of this server (and use up its free quota). Browsers always send Origin on
 * WebSocket connections; the Worker's own address is always allowed.
 */
function originAllowed(req: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (allowed.length === 0) return true;
  const origin = req.headers.get('Origin');
  return !!origin && (origin === new URL(req.url).origin || allowed.includes(origin));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routePartykitRequest(request, env, {
      onBeforeConnect: (req, lobby) => {
        if (!ROOM_CODE_PATTERN.test(lobby.name)) return new Response('Unknown room', { status: 404 });
        if (!originAllowed(req, env)) return new Response('Forbidden', { status: 403 });
      },
    });
    return response ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
