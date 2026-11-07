import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Color,
  type LegalActions,
  type PieceType,
  type Square,
  describeResult,
  findKing,
  kingInDanger,
  legalActions,
  opposite,
} from '../../engine';
import type { GameController } from '../controllers';
import { loadValue, saveValue } from '../storage';
import { Board, type TargetKind } from './Board';
import { Banner, CardReveal, GameOverModal, PromotionPicker, type Reveal } from './Overlays';
import { CardCounter, CardZone, GameLog, PlayerBar } from './Panels';
import { COLOR_NAME } from './Piece';

const NO_ACTIONS: LegalActions = { moves: [], drops: [], teleports: [], canEndTurn: false };

const BOARD_THEMES = { green: 'Green', wood: 'Wood', candy: 'Candy' } as const;
type BoardTheme = keyof typeof BOARD_THEMES;

const MODE_TITLE = { ai: 'vs Computer', local: 'Pass & Play', online: 'Online' };

interface GameScreenProps {
  game: GameController;
  roomCode?: string;
  onLeave: () => void;
}

export function GameScreen({ game, roomCode, onLeave }: GameScreenProps) {
  const { view, myColors, players } = game;
  const [selected, setSelected] = useState<Square | null>(null);
  const [dropPiece, setDropPiece] = useState<PieceType | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [theme, setTheme] = useState<BoardTheme>(() => loadValue('cc:board', 'green'));
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [banner, setBanner] = useState<{ id: number; text: string; tone: 'danger' | 'info' } | null>(null);
  const [resultDismissed, setResultDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  const names: Record<Color, string> = {
    w: players.w?.name ?? COLOR_NAME.w,
    b: players.b?.name ?? COLOR_NAME.b,
  };
  const seatsFilled = !!players.w && !!players.b;
  const myTurn = !!view && view.phase !== 'over' && myColors.includes(view.pos.turn);
  const canAct = myTurn && seatsFilled && !game.thinking;
  const legal = useMemo(() => (view && canAct ? legalActions(view) : NO_ACTIONS), [view, canAct]);

  // Any new state invalidates a half-made selection.
  useEffect(() => {
    setSelected(null);
    setDropPiece(null);
    setPromotion(null);
  }, [view]);

  useEffect(() => {
    if (!view?.result) setResultDismissed(false);
  }, [view?.result]);

  // Only animate what happens after the screen opens, not the state we joined with.
  const firstSeq = useRef<number | null>(null);
  if (view && firstSeq.current === null) firstSeq.current = view.seq;
  const animKey = view && view.seq !== firstSeq.current ? view.seq : 0;

  // Dramatic reveals for cards that end the turn on the spot, and a banner for check.
  const seenLog = useRef<{ length: number; note?: string } | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (!view) return;
    const last = view.log.at(-1);
    const prev = seenLog.current;
    seenLog.current = { length: view.log.length, note: last?.note };
    if (!prev || !last || (prev.length === view.log.length && prev.note === last.note)) return;

    const newDraw = view.log.length > prev.length;
    if (newDraw && (last.card === 'skip' || last.card === 'undo' || last.note === 'No legal moves.')) {
      const you = myColors.length === 1 && myColors[0] === last.color;
      setReveal({ id: Date.now(), card: last.card, caption: you ? 'You drew' : `${names[last.color]} drew`, note: last.note });
      timers.current.push(window.setTimeout(() => setReveal(null), 2600));
    } else if (last.note?.startsWith('Check')) {
      setBanner({ id: Date.now(), text: 'Check! Double move ends', tone: 'danger' });
      timers.current.push(window.setTimeout(() => setBanner(null), 1700));
    }
  }, [view, myColors, names.w, names.b]);

  // Space bar draws a card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !canAct || view?.phase !== 'draw') return;
      if (e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      game.send({ kind: 'draw' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canAct, view, game]);

  // Tab title: say when it's your turn in an online game. Restored on leaving.
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    const base = `${roomCode ? `Room ${roomCode}` : MODE_TITLE[game.mode]} · Chance Chess`;
    document.title = game.mode === 'online' && canAct ? `● Your turn · ${base}` : base;
  }, [canAct, roomCode, game.mode]);

  const shareUrl = roomCode ? `${window.location.origin}/?room=${roomCode}` : '';
  const copyLink = () => {
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      timers.current.push(window.setTimeout(() => setCopied(false), 1500));
    });
  };

  if (!view) {
    return (
      <div className="center-screen">
        <div className="spinner" aria-hidden />
        <p>{game.online ? 'Joining game…' : 'Connecting…'}</p>
        <button className="btn btn-ghost" onClick={onLeave} type="button">
          Back
        </button>
      </div>
    );
  }

  const baseOrientation: Color = myColors.length === 1 ? myColors[0] : 'w';
  const orientation = flipped ? opposite(baseOrientation) : baseOrientation;
  const board = view.pos.board;

  const targets = new Map<Square, TargetKind>();
  if (dropPiece) {
    for (const d of legal.drops) if (d.piece === dropPiece) targets.set(d.to, 'drop');
  } else if (selected !== null) {
    for (const t of legal.teleports) if (t.from === selected) targets.set(t.to, 'teleport');
    for (const m of legal.moves) {
      if (m.from !== selected) continue;
      const isCapture = !!board[m.to] || (board[m.from]?.type === 'p' && m.from % 8 !== m.to % 8);
      targets.set(m.to, isCapture ? 'capture' : 'move');
    }
  }
  const movable = new Set<Square>([...legal.moves.map((m) => m.from), ...legal.teleports.map((t) => t.from)]);
  const dangerKings = (['w', 'b'] as Color[])
    .filter((c) => !view.result && kingInDanger(view.pos, c))
    .map((c) => findKing(board, c));

  function onSquareClick(sq: Square) {
    if (!canAct || view!.phase !== 'act') return;
    const target = targets.get(sq);

    if (dropPiece) {
      if (target === 'drop') game.send({ kind: 'drop', piece: dropPiece, to: sq });
      setDropPiece(null);
      return;
    }
    if (selected !== null && target) {
      if (target === 'teleport') game.send({ kind: 'teleport', from: selected, to: sq });
      else if (legal.moves.some((m) => m.from === selected && m.to === sq && m.promotion)) setPromotion({ from: selected, to: sq });
      else game.send({ kind: 'move', from: selected, to: sq });
      setSelected(null);
      return;
    }
    setSelected(movable.has(sq) && sq !== selected ? sq : null);
  }

  const me = myColors.length === 1 ? myColors[0] : null;
  const turnName = names[view.pos.turn];
  const myKingInDanger = !view.result && myColors.some((c) => c === view.pos.turn && kingInDanger(view.pos, c));

  let status: string;
  if (view.result) status = 'Game over';
  else if (!seatsFilled) status = 'Waiting for opponent';
  else if (myTurn) status = myColors.length === 2 ? `${turnName}'s turn` : 'Your turn';
  else status = `${turnName}'s turn`;

  let outcome: 'win' | 'loss' | 'draw' | 'neutral' = 'neutral';
  if (view.result) {
    if (!view.result.winner) outcome = 'draw';
    else if (me) outcome = view.result.winner === me ? 'win' : 'loss';
    else if (myColors.length === 2) outcome = 'win';
  }
  const iAskedRematch = !!me && game.rematchRequested.includes(me);
  const theyAskedRematch = !!me && game.rematchRequested.includes(opposite(me));
  const canRematch = game.mode !== 'online' || !!me;
  const rematchLabel = game.mode === 'online' ? (iAskedRematch ? 'Waiting for opponent…' : 'Rematch') : 'Play again';

  const top = opposite(orientation);
  const themeKeys = Object.keys(BOARD_THEMES) as BoardTheme[];
  const nextTheme = () => {
    const t = themeKeys[(themeKeys.indexOf(theme) + 1) % themeKeys.length];
    setTheme(t);
    saveValue('cc:board', t);
  };

  return (
    <div className="game-screen">
      <header className="topbar">
        <button className="brand" onClick={onLeave} type="button" aria-label="Back to main menu">
          <img src="/pieces/wN.svg" alt="" />
          <span>
            Chance <b>Chess</b>
          </span>
        </button>
        {roomCode && (
          <button className="room-chip" type="button" onClick={copyLink} title="Copy invite link">
            Room <b>{roomCode}</b> <span>{copied ? '✓ Copied' : 'Copy link'}</span>
            {!game.online && <em className="offline"> · reconnecting</em>}
          </button>
        )}
        <nav className="top-actions" aria-label="Game options">
          <button className="chip-btn" type="button" onClick={nextTheme} title="Change board colours">
            ◐ <span className="lbl">{BOARD_THEMES[theme]}</span>
          </button>
          <button className="chip-btn" type="button" onClick={() => setFlipped((f) => !f)} title="Flip board">
            ⇅ <span className="lbl">Flip</span>
          </button>
          {!view.result && myColors.length > 0 && seatsFilled && (
            <button
              className="chip-btn danger"
              type="button"
              onClick={() => {
                if (window.confirm('Resign this game?')) game.send({ kind: 'resign' });
              }}
            >
              ⚑ <span className="lbl">Resign</span>
            </button>
          )}
        </nav>
      </header>

      <main className="game-layout">
        <section className="board-area" aria-label="Board">
          <PlayerBar color={top} view={view} player={players[top]} isYou={me === top} />
          <div className={`board-frame theme-${theme}`}>
            <Board
              board={board}
              orientation={orientation}
              selected={selected}
              targets={targets}
              movable={canAct && view.phase === 'act' ? movable : new Set()}
              highlight={view.highlight}
              dangerKings={dangerKings}
              events={view.events}
              animKey={animKey}
              onSquareClick={onSquareClick}
            />
            {promotion && (
              <PromotionPicker color={view.pos.turn} onPick={(t) => game.send({ kind: 'move', ...promotion, promotion: t })} />
            )}
            {reveal && <CardReveal reveal={reveal} />}
            {banner && <Banner {...banner} />}
            {view.result && !resultDismissed && (
              <GameOverModal
                outcome={outcome}
                detail={describeResult(view.result, names)}
                rematchLabel={rematchLabel}
                rematchDisabled={iAskedRematch}
                rematchNote={theyAskedRematch ? 'Your opponent wants a rematch!' : undefined}
                onRematch={canRematch ? game.rematch : undefined}
                onClose={() => setResultDismissed(true)}
                onLeave={onLeave}
              />
            )}
          </div>
          <PlayerBar color={orientation} view={view} player={players[orientation]} isYou={me === orientation} />
        </section>

        <aside className="side-area">
          <div className={`status-pill ${canAct ? 'mine' : ''} ${view.result ? 'over' : ''}`} role="status">
            {status}
            {myKingInDanger && <span className="danger-tag">⚠ King in danger!</span>}
          </div>
          {game.error && (
            <div className="error-toast" key={game.error}>
              {game.error}
            </div>
          )}

          {!seatsFilled && roomCode ? (
            <div className="panel invite">
              <div className="zone-title">Invite a friend</div>
              <p className="zone-hint">Send them this link. The game starts as soon as they join.</p>
              <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
              <button className="btn btn-primary" type="button" onClick={copyLink}>
                {copied ? '✓ Copied!' : 'Copy invite link'}
              </button>
            </div>
          ) : view.result ? (
            <div className="panel result-panel">
              <div className="zone-title">{describeResult(view.result, names)}</div>
              <div className="row-buttons">
                {canRematch && (
                  <button className="btn btn-primary" type="button" onClick={game.rematch} disabled={iAskedRematch}>
                    {rematchLabel}
                  </button>
                )}
                <button className="btn btn-ghost" type="button" onClick={onLeave}>
                  Main menu
                </button>
              </div>
            </div>
          ) : (
            <CardZone
              view={view}
              myTurn={myTurn}
              canAct={canAct}
              legal={legal}
              turnName={turnName}
              thinking={game.thinking}
              dropPiece={dropPiece}
              onDraw={() => game.send({ kind: 'draw' })}
              onEndTurn={() => game.send({ kind: 'endTurn' })}
              onPickDrop={(p) => {
                setSelected(null);
                setDropPiece(p);
              }}
            />
          )}

          <details className="panel" open>
            <summary>Moves</summary>
            <GameLog view={view} names={names} />
          </details>
          <details className="panel">
            <summary>Card counter</summary>
            <CardCounter view={view} names={names} />
          </details>
        </aside>
      </main>
    </div>
  );
}
