// Cloudflare Worker for online games. Each room code maps to one GameRoom
// Durable Object, which holds the authoritative game state, draws the cards
// (so clients can't cheat), and broadcasts every change to the players.

import { type Connection, Server, routePartykitRequest } from 'partyserver';
import {
  type Action,
  type Color,
  type GameRules,
  type GameState,
  DEFAULT_RULES,
  applyAction,
  newGame,
  opposite,
  toView,
} from '../engine';
import {
  type ClientMessage,
  type PlayerInfo,
  type ServerMessage,
  ROOM_CODE_PATTERN,
} from '../shared/protocol';

interface Env {
  GameRoom: DurableObjectNamespace<GameRoom>;
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
}

interface ConnState {
  token: string;
  color: Color | null;
}

/** Rooms with no activity for this long are deleted. */
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

const cleanName = (name: unknown): string =>
  (typeof name === 'string' ? name.trim().slice(0, 20) : '') || 'Player';

export class GameRoom extends Server<Env> {
  // Hibernation lets Cloudflare evict the object between messages; state is
  // reloaded from storage in onStart() when it wakes up.
  static options = { hibernate: true };

  private room: RoomData | null = null;

  async onStart(): Promise<void> {
    this.room = (await this.ctx.storage.get<RoomData>('room')) ?? null;
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
    }
  }

  onClose(conn: Connection<ConnState>): void {
    if (this.room) this.broadcastState(conn.id);
  }

  async onAlarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.room = null;
  }

  private async join(conn: Connection<ConnState>, { token, name, seat, rules }: ClientMessage & { type: 'join' }) {
    if (typeof token !== 'string' || token.length < 16) {
      return this.send(conn, { type: 'error', message: 'Bad join request.' });
    }

    if (!this.room) {
      const creatorSeat: Color = seat === 'w' || seat === 'b' ? seat : Math.random() < 0.5 ? 'w' : 'b';
      const gameRules: GameRules = {
        checkEndsDoubleMove: rules?.checkEndsDoubleMove ?? DEFAULT_RULES.checkEndsDoubleMove,
      };
      this.room = { state: newGame(Math.random, gameRules), seats: { w: null, b: null }, rematch: [], creatorSeat };
    }
    const { seats } = this.room;

    let color: Color | null = (['w', 'b'] as const).find((c) => seats[c]?.token === token) ?? null;
    if (!color) {
      // First player gets their preferred seat; the next player takes the other one.
      const preferred = this.room.creatorSeat ?? 'w';
      color = !seats[preferred] ? preferred : !seats[opposite(preferred)] ? opposite(preferred) : null;
      if (color) seats[color] = { token, name: cleanName(name) };
    } else {
      seats[color]!.name = cleanName(name);
    }

    conn.setState({ token, color });
    this.send(conn, { type: 'welcome', color });
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

    const result = applyAction(room.state, action, color);
    if (!result.ok) return this.send(conn, { type: 'error', message: result.error });

    room.state = result.state;
    await this.save();
    this.broadcastState();
  }

  private async requestRematch(conn: Connection<ConnState>) {
    const room = this.room;
    const color = conn.state?.color;
    if (!room || !color || room.state.phase !== 'over') return;
    if (!room.rematch.includes(color)) room.rematch.push(color);

    if (room.rematch.length === 2) {
      // New game with colours swapped.
      room.state = newGame(Math.random, room.state.rules);
      room.seats = { w: room.seats.b, b: room.seats.w };
      room.rematch = [];
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

  private async save() {
    await this.ctx.storage.put('room', this.room);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
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
    };
    this.broadcast(JSON.stringify(msg), closingId ? [closingId] : []);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routePartykitRequest(request, env, {
      onBeforeConnect: (_req, lobby) => {
        if (!ROOM_CODE_PATTERN.test(lobby.name)) return new Response('Unknown room', { status: 404 });
      },
    });
    return response ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
