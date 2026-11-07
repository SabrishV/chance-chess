import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Color,
  type LegalActions,
  type PieceType,
  type Square,
  CARDS,
  describeResult,
  findKing,
  kingInDanger,
  legalActions,
  opposite,
} from '../../engine';
import type { GameController } from '../controllers';
import { COLOR_NAME, GLYPH } from '../pieces';
import { Board, type TargetKind } from './Board';
import { CardPanel, DeckCounts, GameLog, PlayerBar } from './Panels';

const NO_ACTIONS: LegalActions = { moves: [], drops: [], teleports: [], canEndTurn: false };

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
  const [toast, setToast] = useState<string | null>(null);

  const names: Record<Color, string> = {
    w: players.w?.name ?? COLOR_NAME.w,
    b: players.b?.name ?? COLOR_NAME.b,
  };
  const seatsFilled = !!players.w && !!players.b;
  const canAct =
    !!view && view.phase !== 'over' && seatsFilled && !game.thinking && myColors.includes(view.pos.turn);

  const legal = useMemo(() => (view && canAct ? legalActions(view) : NO_ACTIONS), [view, canAct]);

  // Any new state invalidates a half-made selection.
  useEffect(() => {
    setSelected(null);
    setDropPiece(null);
    setPromotion(null);
  }, [view]);

  // Announce card draws: always the opponent's, and our own when something special happened.
  const lastLog = view?.log.at(-1);
  const toastKey = lastLog ? `${view!.log.length}|${lastLog.note ?? ''}` : '';
  const firstToastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!lastLog) return;
    // Don't replay an old draw when (re)joining a game in progress.
    firstToastKey.current ??= toastKey;
    if (toastKey === firstToastKey.current) return;
    const ours = myColors.includes(lastLog.color);
    if (ours && !lastLog.note) return;
    setToast(`${names[lastLog.color]} drew ${CARDS[lastLog.card].name}.${lastLog.note ? ` ${lastLog.note}` : ''}`);
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toastKey]);

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

  if (!view) {
    return (
      <div className="center-screen">
        <p>{game.online ? 'Joining game…' : 'Connecting…'}</p>
        <button className="btn secondary" onClick={onLeave} type="button">
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
    .filter((c) => kingInDanger(view.pos, c))
    .map((c) => findKing(view.pos.board, c));

  function onSquareClick(sq: Square) {
    if (!canAct || view!.phase !== 'act') return;
    const target = targets.get(sq);

    if (dropPiece) {
      if (target === 'drop') game.send({ kind: 'drop', piece: dropPiece, to: sq });
      setDropPiece(null);
      return;
    }

    if (selected !== null && target) {
      if (target === 'teleport') {
        game.send({ kind: 'teleport', from: selected, to: sq });
      } else if (legal.moves.some((m) => m.from === selected && m.to === sq && m.promotion)) {
        setPromotion({ from: selected, to: sq });
      } else {
        game.send({ kind: 'move', from: selected, to: sq });
      }
      setSelected(null);
      return;
    }

    setSelected(movable.has(sq) && sq !== selected ? sq : null);
  }

  const turnName = names[view.pos.turn];
  const me = myColors.length === 1 ? myColors[0] : null;
  let status: string;
  if (view.result) status = describeResult(view.result, names);
  else if (!seatsFilled) status = 'Waiting for your opponent to join…';
  else if (canAct) status = myColors.length === 2 ? `${turnName} to play.` : 'Your turn.';
  else status = `${turnName}'s turn.`;

  const myKingInDanger = !view.result && myColors.some((c) => c === view.pos.turn && kingInDanger(view.pos, c));
  const top = opposite(orientation);
  const shareUrl = roomCode ? `${window.location.origin}/?room=${roomCode}` : '';

  return (
    <div className="game-screen">
      <header className="topbar">
        <button className="brand link" onClick={onLeave} type="button">
          ♞ Chance Chess
        </button>
        {roomCode && (
          <div className="room-info">
            Room <b>{roomCode}</b>
            <button className="btn tiny" type="button" onClick={() => navigator.clipboard?.writeText(shareUrl)}>
              Copy link
            </button>
            {!game.online && <span className="offline">reconnecting…</span>}
          </div>
        )}
      </header>

      <main className="game-layout">
        <section className="board-column">
          <PlayerBar color={top} view={view} player={players[top]} isYou={me === top} />
          <div className="board-wrap">
            <Board
              board={board}
              orientation={orientation}
              selected={selected}
              targets={targets}
              movable={canAct && view.phase === 'act' ? movable : new Set()}
              highlight={view.highlight}
              dangerKings={dangerKings}
              onSquareClick={onSquareClick}
            />
            {promotion && (
              <div className="promotion" role="dialog" aria-label="Choose promotion piece">
                {(['q', 'r', 'b', 'n'] as PieceType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => game.send({ kind: 'move', ...promotion, promotion: t })}
                  >
                    <span className={`piece ${view.pos.turn === 'w' ? 'white' : 'black'}`}>{GLYPH[t]}</span>
                  </button>
                ))}
              </div>
            )}
            {toast && <div className="toast">{toast}</div>}
          </div>
          <PlayerBar color={orientation} view={view} player={players[orientation]} isYou={me === orientation} />
        </section>

        <aside className="side-column">
          <div className={`status ${view.result ? 'over' : ''}`}>
            {status}
            {myKingInDanger && <div className="warning">⚠ Your king is under attack!</div>}
            {game.error && <div className="error">{game.error}</div>}
          </div>

          {!seatsFilled && roomCode ? (
            <div className="invite">
              <p>Send this link to a friend:</p>
              <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn" type="button" onClick={() => navigator.clipboard?.writeText(shareUrl)}>
                Copy invite link
              </button>
            </div>
          ) : view.result ? (
            <div className="game-over">
              {me !== null || game.mode !== 'online' ? (
                <button className="btn" type="button" onClick={game.rematch} disabled={!!me && game.rematchRequested.includes(me)}>
                  {me && game.rematchRequested.includes(me) ? 'Waiting for opponent…' : 'Rematch'}
                </button>
              ) : null}
              {game.mode === 'online' && me && game.rematchRequested.includes(opposite(me)) && (
                <p className="small">Your opponent wants a rematch.</p>
              )}
              <button className="btn secondary" type="button" onClick={onLeave}>
                Back to menu
              </button>
            </div>
          ) : (
            <CardPanel
              view={view}
              canAct={canAct}
              legal={legal}
              waitingFor={canAct ? '' : turnName}
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
            <summary>Cards left in each deck</summary>
            <DeckCounts view={view} names={names} />
          </details>

          <div className="controls">
            <button className="btn tiny secondary" type="button" onClick={() => setFlipped((f) => !f)}>
              Flip board
            </button>
            {!view.result && myColors.length > 0 && seatsFilled && (
              <button
                className="btn tiny danger"
                type="button"
                onClick={() => {
                  if (window.confirm('Resign this game?')) game.send({ kind: 'resign' });
                }}
              >
                Resign
              </button>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
