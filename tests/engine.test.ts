import { describe, expect, it } from 'vitest';
import {
  type Action,
  type CardType,
  type Color,
  type GameMode,
  type GameState,
  type PieceType,
  type Position,
  applyAction,
  applyMove,
  checkTimeout,
  DEFAULT_RULES,
  findKing,
  generateMoves,
  isAttacked,
  isLastChance,
  legalActions,
  newGame,
  opposite,
  parseSquare as sq,
  positionFromFen,
  startClock,
  timeLeft,
  toView,
} from '../src/engine';
import { chooseAction } from '../src/engine/ai';

// ---------------------------------------------------------------------------
// Move generation, checked against standard perft numbers. Chance Chess itself
// allows moving into check, so the perft helper filters to legal moves first.

function fullFen(fen: string): Position {
  const [placement, turn, castling, ep] = fen.split(' ');
  const pos = positionFromFen(placement, turn as Color);
  pos.castling = {
    w: { k: castling.includes('K'), q: castling.includes('Q') },
    b: { k: castling.includes('k'), q: castling.includes('q') },
  };
  if (ep !== '-') {
    const target = sq(ep);
    pos.ep = { target, pawn: turn === 'w' ? target - 8 : target + 8, by: opposite(turn as Color) };
  }
  return pos;
}

function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  let total = 0;
  for (const m of generateMoves(pos)) {
    const next = applyMove(pos, m).pos;
    if (isAttacked(next.board, findKing(next.board, pos.turn), opposite(pos.turn))) continue;
    next.turn = opposite(pos.turn);
    total += perft(next, depth - 1);
  }
  return total;
}

describe('move generation', () => {
  it('matches perft from the starting position', () => {
    const start = newGame().pos;
    expect(perft(start, 1)).toBe(20);
    expect(perft(start, 2)).toBe(400);
    expect(perft(start, 3)).toBe(8902);
  });

  it('matches perft for "Kiwipete" (castling, en passant, promotion)', () => {
    const pos = fullFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -');
    expect(perft(pos, 1)).toBe(48);
    expect(perft(pos, 2)).toBe(2039);
    expect(perft(pos, 3)).toBe(97862);
  });

  it('matches perft for an endgame with en passant pins', () => {
    const pos = fullFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -');
    expect(perft(pos, 3)).toBe(2812);
    expect(perft(pos, 4)).toBe(43238);
  });
});

// ---------------------------------------------------------------------------
// Game rules

/** A game where each side's next cards are fixed (last element is drawn first). */
function riggedGame(cards: Partial<Record<Color, CardType[]>>, fen?: string, mode: GameMode = 'capture'): GameState {
  const g = newGame(Math.random, { ...DEFAULT_RULES, mode });
  if (fen) g.pos = positionFromFen(fen);
  if (cards.w) g.decks.w = [...cards.w].reverse();
  if (cards.b) g.decks.b = [...cards.b].reverse();
  return g;
}

function play(state: GameState, ...steps: [Color, Action][]): GameState {
  let s = state;
  for (const [color, action] of steps) {
    const r = applyAction(s, action, color);
    if (!r.ok) throw new Error(`${color} ${JSON.stringify(action)}: ${r.error}`);
    s = r.state;
  }
  return s;
}

const draw: Action = { kind: 'draw' };
const mv = (from: string, to: string, promotion?: PieceType): Action => ({
  kind: 'move',
  from: sq(from),
  to: sq(to),
  promotion,
});

describe('cards', () => {
  it('Move: one move, then the turn passes', () => {
    const s = play(riggedGame({ w: ['move'] }), ['w', draw], ['w', mv('e2', 'e4')]);
    expect(s.pos.turn).toBe('b');
    expect(s.phase).toBe('draw');
    expect(s.pos.board[sq('e4')]).toEqual({ type: 'p', color: 'w' });
  });

  it('rejects acting out of turn or before drawing', () => {
    const g = riggedGame({ w: ['move'] });
    expect(applyAction(g, mv('e2', 'e4'), 'w').ok).toBe(false);
    expect(applyAction(g, draw, 'b').ok).toBe(false);
  });

  it('Double Move: two moves, and the second one is optional', () => {
    let s = play(riggedGame({ w: ['double', 'double'], b: ['move'] }), ['w', draw], ['w', mv('e2', 'e4')]);
    expect(s.pos.turn).toBe('w');
    expect(s.movesLeft).toBe(1);
    s = play(s, ['w', mv('d2', 'd4')]);
    expect(s.pos.turn).toBe('b');

    s = play(s, ['b', draw], ['b', mv('e7', 'e5')], ['w', draw], ['w', mv('g1', 'f3')], ['w', { kind: 'endTurn' }]);
    expect(s.pos.turn).toBe('b');
  });

  it('Skip: the turn passes without a move', () => {
    const g = riggedGame({ w: ['skip'] });
    const s = play(g, ['w', draw]);
    expect(s.pos.turn).toBe('b');
    expect(s.pos.board).toEqual(g.pos.board);
    expect(s.log.at(-1)?.note).toMatch(/skipped/i);
  });

  it('Undo: takes back your last move, restoring a captured piece', () => {
    let s = riggedGame({ w: ['move', 'move', 'undo'], b: ['move', 'move'] });
    s = play(s, ['w', draw], ['w', mv('e2', 'e4')], ['b', draw], ['b', mv('d7', 'd5')]);
    s = play(s, ['w', draw], ['w', mv('e4', 'd5')]);
    expect(s.inventory.w).toEqual(['p']);
    s = play(s, ['b', draw], ['b', mv('g8', 'f6')], ['w', draw]);

    expect(s.pos.board[sq('e4')]).toEqual({ type: 'p', color: 'w' });
    expect(s.pos.board[sq('d5')]).toEqual({ type: 'p', color: 'b' });
    expect(s.inventory.w).toEqual([]);
    expect(s.pos.turn).toBe('b');
  });

  it('Undo: does nothing if the moved piece was captured since', () => {
    let s = riggedGame({ w: ['move', 'undo'], b: ['move'] }, '4k3/8/8/3p4/8/8/4P3/4K3');
    s = play(s, ['w', draw], ['w', mv('e2', 'e4')], ['b', draw], ['b', mv('d5', 'e4')], ['w', draw]);
    expect(s.log.at(-1)?.note).toMatch(/nothing to take back/i);
    expect(s.pos.board[sq('e4')]).toEqual({ type: 'p', color: 'b' });
    expect(s.pos.turn).toBe('b');
  });

  it('Undo: reverses castling', () => {
    let s = riggedGame({ w: ['move', 'undo'], b: ['move'] }, 'r3k2r/8/8/8/8/8/8/R3K2R');
    s.pos.castling = { w: { k: true, q: true }, b: { k: true, q: true } };
    s = play(s, ['w', draw], ['w', mv('e1', 'g1')], ['b', draw], ['b', mv('a8', 'a7')], ['w', draw]);
    expect(s.pos.board[sq('e1')]?.type).toBe('k');
    expect(s.pos.board[sq('h1')]?.type).toBe('r');
    expect(s.pos.castling.w).toEqual({ k: true, q: true });
  });

  it('Wild: swaps a pawn for a captured piece', () => {
    let s = riggedGame({ w: ['wild'] }, '4k3/8/8/8/8/8/4P3/4K3');
    s.inventory.w = ['q', 'p'];
    const legal = legalActions(play(s, ['w', draw]));
    expect(legal.drops).toEqual([{ piece: 'q', to: sq('e2') }]); // captured pawns can't be swapped in

    s = play(s, ['w', draw], ['w', { kind: 'drop', piece: 'q', to: sq('e2') }]);
    expect(s.pos.board[sq('e2')]).toEqual({ type: 'q', color: 'w' });
    expect(s.inventory.w).toEqual(['p']);
    expect(s.pos.turn).toBe('b');
  });

  it('Wild with nothing to swap still allows a normal move', () => {
    const s = play(riggedGame({ w: ['wild'] }), ['w', draw], ['w', mv('e2', 'e4')]);
    expect(s.pos.turn).toBe('b');
  });

  it('Teleport: any piece to any empty square, pawns never to the back ranks', () => {
    let s = play(riggedGame({ w: ['teleport'] }), ['w', draw]);
    const legal = legalActions(s);
    expect(legal.teleports).toContainEqual({ from: sq('d1'), to: sq('h5') });
    expect(legal.teleports).not.toContainEqual({ from: sq('e2'), to: sq('e8') });
    expect(legal.teleports.every((t) => !s.pos.board[t.to])).toBe(true);

    s = play(s, ['w', { kind: 'teleport', from: sq('d1'), to: sq('h5') }]);
    expect(s.pos.board[sq('h5')]).toEqual({ type: 'q', color: 'w' });
    expect(s.pos.turn).toBe('b');
  });

  it('Teleporting the king loses castling rights', () => {
    let s = riggedGame({ w: ['teleport'] }, '4k3/8/8/8/8/8/8/R3K2R');
    s.pos.castling.w = { k: true, q: true };
    s = play(s, ['w', draw], ['w', { kind: 'teleport', from: sq('e1'), to: sq('e4') }]);
    expect(s.pos.castling.w).toEqual({ k: false, q: false });
  });

  it('capturing the king wins the game', () => {
    const s = play(riggedGame({ w: ['move'] }, '4k3/8/8/8/8/8/8/4K2Q'), ['w', draw], ['w', mv('h1', 'e4')]);
    expect(s.phase).toBe('draw'); // e4 doesn't take the king yet; next line does
    const s2 = play(riggedGame({ w: ['move'] }, '4k3/8/8/8/8/8/8/4Q2K'), ['w', draw], ['w', mv('e1', 'e8')]);
    expect(s2.phase).toBe('over');
    expect(s2.result).toEqual({ winner: 'w', reason: 'king-captured' });
  });

  it('giving check ends a double move (default rule)', () => {
    const s = play(riggedGame({ w: ['double'] }, '4k3/8/8/8/8/8/8/3QK3'), ['w', draw], ['w', mv('d1', 'd8')]);
    expect(s.pos.turn).toBe('b');
    expect(s.log.at(-1)?.note).toMatch(/check/i);
  });

  it('without that rule, a double move can check and then capture the king', () => {
    const g = riggedGame({ w: ['double'] }, '4k3/8/8/8/8/8/8/3QK3');
    g.rules.checkEndsDoubleMove = false;
    const s = play(g, ['w', draw], ['w', mv('d1', 'd8')], ['w', mv('d8', 'e8')]);
    expect(s.result?.winner).toBe('w');
  });

  it('en passant is available only on the next turn', () => {
    let s = riggedGame({ w: ['move', 'move', 'move'], b: ['move', 'skip'] }, '4k3/3p4/8/4P3/8/8/8/4K3');
    s.pos.turn = 'b';
    s = play(s, ['b', draw], ['b', mv('d7', 'd5')], ['w', draw]);
    expect(legalActions(s).moves).toContainEqual({ from: sq('e5'), to: sq('d6') });

    s = play(s, ['w', mv('e1', 'e2')], ['b', draw], ['w', draw]); // black skipped
    expect(legalActions(s).moves).not.toContainEqual({ from: sq('e5'), to: sq('d6') });
  });

  it('records board events for animations', () => {
    let s = play(riggedGame({ w: ['move', 'undo'], b: ['move'] }, '4k3/8/8/3p4/4P3/8/8/4K3'), ['w', draw]);
    const seq = s.seq;
    s = play(s, ['w', mv('e4', 'd5')]);
    expect(s.seq).toBe(seq + 1);
    expect(s.events).toEqual([
      { kind: 'capture', square: sq('d5'), piece: { type: 'p', color: 'b' } },
      { kind: 'slide', from: sq('e4'), to: sq('d5'), piece: { type: 'p', color: 'w' } },
    ]);
    s = play(s, ['b', draw], ['b', mv('e8', 'e7')]);
    s = play(s, ['w', draw]); // Undo
    expect(s.events).toEqual([
      { kind: 'slide', from: sq('d5'), to: sq('e4'), piece: { type: 'p', color: 'w' } },
      { kind: 'appear', square: sq('d5'), piece: { type: 'p', color: 'b' } },
    ]);
  });

  it('resigning ends the game for either player at any time', () => {
    const s = play(newGame(), ['b', { kind: 'resign' }]);
    expect(s.result).toEqual({ winner: 'w', reason: 'resigned' });
  });

  it('reshuffles a new deck when the old one runs out', () => {
    let s = riggedGame({ w: ['skip'], b: ['skip'] });
    s = play(s, ['w', draw], ['b', draw], ['w', draw]);
    expect(s.decks.w.length).toBe(39);
  });

  it('hides deck order in the view sent to players', () => {
    const view = toView(newGame());
    expect('decks' in view).toBe(false);
    expect(view.deckCounts.w).toEqual({ move: 20, double: 5, skip: 4, undo: 3, wild: 5, teleport: 3 });
  });
});

// ---------------------------------------------------------------------------
// Skip and Undo while in check

describe('cursed cards while in check', () => {
  // White king on e1 attacked by a black rook on a1.
  const CHECK = '4k3/8/8/8/8/8/8/r3K3';

  it('shuffles Skip back into the deck and draws the next card', () => {
    const s = play(riggedGame({ w: ['skip', 'move'] }, CHECK), ['w', draw]);
    expect(s.card).toBe('move');
    expect(s.log.at(-1)?.heldBack).toEqual(['skip']);
    expect(s.decks.w).toContain('skip');
  });

  it('holds back Undo too', () => {
    const s = play(riggedGame({ w: ['undo', 'skip', 'double'] }, CHECK), ['w', draw]);
    expect(s.card).toBe('double');
    // Curses go back to a random place, so the same one can come up more than once.
    const heldBack = s.log.at(-1)?.heldBack ?? [];
    expect(heldBack[0]).toBe('undo');
    expect(heldBack.every((c) => c === 'skip' || c === 'undo')).toBe(true);
    expect(s.decks.w.filter((c) => c === 'skip' || c === 'undo').sort()).toEqual(['skip', 'undo']);
  });

  it('finds a playable card even when only curses are left', () => {
    const s = play(riggedGame({ w: ['skip', 'undo'] }, CHECK), ['w', draw]);
    expect(['skip', 'undo']).not.toContain(s.card);
  });

  it('deals Skip as normal when the king is safe', () => {
    const s = play(riggedGame({ w: ['skip'] }), ['w', draw]);
    expect(s.pos.turn).toBe('b');
    expect(s.log.at(-1)?.heldBack).toBeUndefined();
  });

  it('deals Skip in check when the house rule is off', () => {
    const g = riggedGame({ w: ['skip', 'move'] }, CHECK);
    g.rules.noCursedInCheck = false;
    const s = play(g, ['w', draw]);
    expect(s.pos.turn).toBe('b');
    expect(s.log.at(-1)?.heldBack).toBeUndefined();
  });

  it('always holds curses back in checkmate mode', () => {
    const g = riggedGame({ w: ['skip', 'move'] }, CHECK, 'checkmate');
    g.rules.noCursedInCheck = false;
    const s = play(g, ['w', draw]);
    expect(s.card).toBe('move');
    expect(s.log.at(-1)?.heldBack).toEqual(['skip']);
  });
});

// ---------------------------------------------------------------------------
// Checkmate mode

describe('checkmate mode', () => {
  // Back-rank mate: white king h1 boxed in by its own pawns, black rook on a1.
  const MATED = '6k1/8/8/8/8/8/6PP/r6K';

  it('does not allow moving into check', () => {
    const s = play(riggedGame({ w: ['move'] }, '4k3/8/8/8/8/8/r7/4K3', 'checkmate'), ['w', draw]);
    const kingMoves = legalActions(s).moves.filter((m) => m.from === sq('e1')).map((m) => m.to);
    expect(kingMoves.sort()).toEqual([sq('d1'), sq('f1')].sort());
    const r = applyAction(s, mv('e1', 'e2'), 'w');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/check/);
  });

  it('still allows it in capture mode', () => {
    const s = play(riggedGame({ w: ['move'] }, '4k3/8/8/8/8/8/r7/4K3'), ['w', draw], ['w', mv('e1', 'e2')]);
    expect(s.pos.board[sq('e2')]?.type).toBe('k');
  });

  it('flags the last chance before the draw', () => {
    expect(isLastChance(riggedGame({ w: ['move'] }, MATED, 'checkmate'))).toBe(true);
    expect(isLastChance(riggedGame({ w: ['move'] }, MATED))).toBe(false);
  });

  it('is checkmate when the drawn card cannot save the king', () => {
    const s = play(riggedGame({ w: ['double'] }, MATED, 'checkmate'), ['w', draw]);
    expect(s.result).toEqual({ winner: 'b', reason: 'checkmate' });
    expect(s.log.at(-1)).toMatchObject({ lastChance: true, note: 'Checkmate!' });
  });

  it('a lucky Teleport saves the king', () => {
    const s = play(riggedGame({ w: ['teleport'] }, MATED, 'checkmate'), ['w', draw]);
    expect(s.result).toBeNull();
    expect(s.log.at(-1)?.note).toBe('Saved by the Teleport!');
    const { teleports } = legalActions(s);
    expect(teleports.length).toBeGreaterThan(0);
    const saved = play(s, ['w', { kind: 'teleport', ...teleports[0] }]);
    expect(saved.pos.turn).toBe('b');
  });

  it('never deals Skip on the last chance', () => {
    const s = play(riggedGame({ w: ['skip', 'move'] }, MATED, 'checkmate'), ['w', draw]);
    expect(s.log.at(-1)?.heldBack).toEqual(['skip']);
    expect(s.result?.reason).toBe('checkmate');
  });

  it('Undo cannot put your own king back in check', () => {
    // White blocks a check with Ra3-e3; taking that back would expose the king.
    let s = riggedGame({ w: ['move', 'undo'], b: ['move'] }, '4r2k/8/8/8/8/R7/8/4K3', 'checkmate');
    s = play(s, ['w', draw], ['w', mv('a3', 'e3')], ['b', draw], ['b', mv('h8', 'g8')], ['w', draw]);
    expect(s.log.at(-1)?.note).toBe('Nothing to take back.');
    expect(s.pos.board[sq('e3')]?.type).toBe('r');
  });
});

// ---------------------------------------------------------------------------
// Card hand mode

describe('card hand mode', () => {
  it('keeps a power card and makes a normal move instead', () => {
    let s = play(riggedGame({ w: ['teleport'] }, undefined, 'hand'), ['w', draw]);
    expect(legalActions(s).canKeep).toBe(true);
    s = play(s, ['w', { kind: 'keep' }]);
    expect(s.hands.w).toEqual(['teleport']);
    expect(s.card).toBe('move');
    expect(legalActions(s).teleports).toEqual([]);
    s = play(s, ['w', mv('e2', 'e4')]);
    expect(s.pos.turn).toBe('b');
    expect(s.log.at(-1)?.kept).toBe('teleport');
  });

  it('cannot keep Move cards, or more than three cards', () => {
    expect(legalActions(play(riggedGame({ w: ['move'] }, undefined, 'hand'), ['w', draw])).canKeep).toBe(false);
    const g = riggedGame({ w: ['double'] }, undefined, 'hand');
    g.hands.w = ['wild', 'wild', 'teleport'];
    expect(legalActions(play(g, ['w', draw])).canKeep).toBe(false);
  });

  it('plays a kept card instead of the drawn one, keeping a drawn power card', () => {
    const g = riggedGame({ w: ['double'] }, undefined, 'hand');
    g.hands.w = ['teleport'];
    let s = play(g, ['w', draw], ['w', { kind: 'playKept', card: 'teleport' }]);
    expect(s.card).toBe('teleport');
    expect(s.hands.w).toEqual(['double']);
    expect(s.log.at(-1)).toMatchObject({ played: 'teleport', kept: 'double' });
    s = play(s, ['w', { kind: 'teleport', from: sq('d1'), to: sq('d4') }]);
    expect(s.pos.turn).toBe('b');
  });

  it('sets a drawn Move card aside when a kept card is played', () => {
    const g = riggedGame({ w: ['move'] }, undefined, 'hand');
    g.hands.w = ['wild'];
    const s = play(g, ['w', draw], ['w', { kind: 'playKept', card: 'wild' }]);
    expect(s.hands.w).toEqual([]);
    expect(s.card).toBe('wild');
  });

  it('only before the first move of the turn', () => {
    const s = play(riggedGame({ w: ['double'] }, undefined, 'hand'), ['w', draw], ['w', mv('e2', 'e4')]);
    expect(applyAction(s, { kind: 'keep' }, 'w').ok).toBe(false);
  });

  it('Skip and Undo still hit you right away', () => {
    const g = riggedGame({ w: ['skip'] }, undefined, 'hand');
    g.hands.w = ['teleport'];
    const s = play(g, ['w', draw]);
    expect(s.pos.turn).toBe('b');
    expect(s.hands.w).toEqual(['teleport']);
  });

  it('hands are visible to both players', () => {
    const g = riggedGame({}, undefined, 'hand');
    g.hands.b = ['double'];
    expect(toView(g).hands.b).toEqual(['double']);
  });

  describe('plays to checkmate', () => {
    // Back-rank mate: white king h1 boxed in by its own pawns, black rook on a1.
    const MATED = '6k1/8/8/8/8/8/6PP/r6K';

    it('does not allow moving into check', () => {
      const s = play(riggedGame({ w: ['move'] }, '4k3/8/8/8/8/8/r7/4K3', 'hand'), ['w', draw]);
      expect(applyAction(s, mv('e1', 'e2'), 'w').ok).toBe(false);
    });

    it('is checkmate when neither the drawn card nor the hand can save the king', () => {
      const g = riggedGame({ w: ['move'] }, MATED, 'hand');
      g.hands.w = ['double'];
      expect(isLastChance(g)).toBe(true);
      const s = play(g, ['w', draw]);
      expect(s.result).toEqual({ winner: 'b', reason: 'checkmate' });
    });

    it('a kept Teleport gets the king out', () => {
      const g = riggedGame({ w: ['move'] }, MATED, 'hand');
      g.hands.w = ['teleport'];
      expect(isLastChance(g)).toBe(false);
      let s = play(g, ['w', draw]);
      expect(s.result).toBeNull();
      expect(legalActions(s).playable).toEqual(['teleport']);
      s = play(s, ['w', { kind: 'playKept', card: 'teleport' }]);
      s = play(s, ['w', { kind: 'teleport', ...legalActions(s).teleports[0] }]);
      expect(s.pos.turn).toBe('b');
    });

    it('cannot keep a card when no normal move gets out of check', () => {
      const s = play(riggedGame({ w: ['teleport'] }, MATED, 'hand'), ['w', draw]);
      expect(legalActions(s).canKeep).toBe(false);
      expect(legalActions(s).teleports.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Clock

describe('clock', () => {
  const blitz = { ...DEFAULT_RULES, timeControl: { initialMs: 60_000, incrementMs: 2_000 } };
  const clocked = (cards: CardType[]) => {
    const g = newGame(Math.random, blitz);
    g.decks.w = [...cards].reverse();
    g.decks.b = Array(10).fill('move');
    return startClock(g, 0);
  };
  const at = (s: GameState, color: Color, action: Action, now: number) => {
    const r = applyAction(s, action, color, Math.random, now);
    if (!r.ok) throw new Error(r.error);
    return r.state;
  };

  it('has no clock unless a time control is chosen', () => {
    expect(newGame().clock).toBeNull();
    expect(timeLeft(newGame(), 'w', 1e12)).toBe(Infinity);
  });

  it("runs only the side to move's clock and adds the increment after each turn", () => {
    let s = clocked(['move']);
    s = at(s, 'w', draw, 5_000);
    s = at(s, 'w', mv('e2', 'e4'), 12_000); // white used 12s, gets +2s
    expect(s.clock!.remaining.w).toBe(50_000);
    expect(timeLeft(s, 'w', 30_000)).toBe(50_000); // white's clock is stopped
    expect(timeLeft(s, 'b', 30_000)).toBe(42_000); // black's has run 18s
  });

  it('a turn that ends on the spot (Skip) still adds the increment', () => {
    const s = at(clocked(['skip']), 'w', draw, 3_000);
    expect(s.clock!.remaining.w).toBe(59_000);
    expect(s.clock!.runningSince).toBe(3_000);
  });

  it('flags the side to move when time runs out', () => {
    const s = clocked(['move']);
    expect(checkTimeout(s, 59_999)).toBeNull();
    const over = checkTimeout(s, 60_000)!;
    expect(over.result).toEqual({ winner: 'b', reason: 'timeout' });
    expect(over.clock!.runningSince).toBeNull();
  });

  it('an action sent after the flag fell loses on time', () => {
    const r = applyAction(clocked(['move']), draw, 'w', Math.random, 61_000);
    expect(r.ok && r.state.result).toEqual({ winner: 'b', reason: 'timeout' });
  });

  it('stops the clock when the game ends', () => {
    const s = at(clocked(['move']), 'b', { kind: 'resign' }, 10_000);
    expect(s.clock!.runningSince).toBeNull();
    expect(timeLeft(s, 'w', 999_999)).toBe(50_000);
  });
});

// ---------------------------------------------------------------------------
// AI

describe('ai', () => {
  it('captures the king when it can', () => {
    const s = play(riggedGame({ w: ['move'] }, '4k3/8/8/8/8/8/8/4R1K1'), ['w', draw]);
    expect(chooseAction(s, 'easy')).toEqual({ kind: 'move', from: sq('e1'), to: sq('e8') });
  });

  it('moves its king out of attack', () => {
    const s = play(riggedGame({ w: ['move'] }, '4r1k1/8/8/8/8/8/8/4K3'), ['w', draw]);
    const action = chooseAction(s, 'medium');
    expect(action.kind).toBe('move');
    if (action.kind === 'move') expect(action.from).toBe(sq('e1'));
  });

  it('uses a Wild card to bring back a queen', () => {
    const s = riggedGame({ w: ['wild'] });
    s.inventory.w = ['q'];
    expect(chooseAction(play(s, ['w', draw]), 'medium').kind).toBe('drop');
  });

  it('plays whole games without errors in every mode', () => {
    for (const mode of ['checkmate', 'hand'] as const) {
      let s = newGame(Math.random, { ...DEFAULT_RULES, mode });
      for (let i = 0; i < 150 && s.phase !== 'over'; i++) {
        const r = applyAction(s, chooseAction(s, 'medium'), s.pos.turn);
        if (!r.ok) throw new Error(`${mode}: ${r.error}`);
        s = r.state;
      }
    }
  }, 120_000);

  it('keeps a Teleport rather than wasting it on the first move', () => {
    const s = play(riggedGame({ w: ['teleport'] }, undefined, 'hand'), ['w', draw]);
    expect(chooseAction(s, 'medium').kind).toBe('keep');
  });

  it('plays whole games without errors at every difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      let s = newGame();
      for (let i = 0; i < 120 && s.phase !== 'over'; i++) {
        const r = applyAction(s, chooseAction(s, difficulty), s.pos.turn);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
      }
    }
  }, 120_000);
});
