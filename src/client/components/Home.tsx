import { type ReactNode, useState } from 'react';
import {
  type Color,
  type GameMode,
  type GameRules,
  type TimeControl,
  CARD_ORDER,
  DECK_COMPOSITION,
  DEFAULT_RULES,
  cursedHeldBack,
} from '../../engine';
import { DIFFICULTIES, type Difficulty } from '../../engine/ai';
import { ROOM_CODE_PATTERN, type SeatChoice } from '../../shared/protocol';
import { Card } from './Cards';
import { AUTHOR, FAQ, MODES } from '../content';
import { CardGallery } from './Panels';

export type StartRequest =
  | { kind: 'ai'; humanColor: Color; difficulty: Difficulty; rules: GameRules }
  | { kind: 'local'; rules: GameRules }
  | { kind: 'create'; seat: SeatChoice; rules: GameRules }
  | { kind: 'join'; code: string };

interface HomeProps {
  name: string;
  onNameChange: (name: string) => void;
  onStart: (req: StartRequest) => void;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

const CLOCKS: Record<string, { label: string; tc: TimeControl | null }> = {
  off: { label: 'No clock', tc: null },
  '3+2': { label: '3+2', tc: { initialMs: 3 * 60_000, incrementMs: 2_000 } },
  '5+3': { label: '5+3', tc: { initialMs: 5 * 60_000, incrementMs: 3_000 } },
  '10+5': { label: '10+5', tc: { initialMs: 10 * 60_000, incrementMs: 5_000 } },
};

const SEATS: [SeatChoice, string][] = [
  ['w', 'White'],
  ['random', 'Random'],
  ['b', 'Black'],
];

const GAME_MODES = Object.keys(MODES) as GameMode[];

const MODE_ICONS: Record<GameMode, ReactNode> = {
  // A crown.
  capture: <path d="M4 17.5L2.8 8l5 3.8L12 5l4.2 6.8 5-3.8L20 17.5zM4.5 20.5h15" />,
  // "#", the notation for checkmate.
  checkmate: <path d="M10 4L8 20M16 4l-2 16M4.5 9h15.5M4 15h15.5" />,
  // Two cards held in a fan.
  hand: (
    <>
      <rect x="9.5" y="3.5" width="10" height="14" rx="2" transform="rotate(10 14.5 10.5)" />
      <path d="M8.2 6.6L5.6 7.1a2 2 0 0 0-1.6 2.3l1.8 10.1a2 2 0 0 0 2.3 1.6l5.3-.9" />
    </>
  ),
};

function ModeIcon({ mode }: { mode: GameMode }) {
  return (
    <span className="mode-icon" aria-hidden>
      <svg viewBox="0 0 24 24">{MODE_ICONS[mode]}</svg>
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  disabled = false,
  title,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>{title}</b>
        {children}
      </span>
    </label>
  );
}


export function Home({ name, onNameChange, onStart }: HomeProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [aiSeat, setAiSeat] = useState<SeatChoice>('w');
  const [onlineSeat, setOnlineSeat] = useState<SeatChoice>('random');
  const [code, setCode] = useState('');
  const [checkEndsDouble, setCheckEndsDouble] = useState(DEFAULT_RULES.checkEndsDoubleMove);
  const [noCursedInCheck, setNoCursedInCheck] = useState(DEFAULT_RULES.noCursedInCheck);
  const [clock, setClock] = useState('off');
  const [mode, setMode] = useState<GameMode>(DEFAULT_RULES.mode);

  const rules: GameRules = { mode, checkEndsDoubleMove: checkEndsDouble, noCursedInCheck, timeControl: CLOCKS[clock].tc };
  const curseRuleLocked = cursedHeldBack({ ...rules, noCursedInCheck: false });
  const cleanCode = code.trim().toUpperCase();
  const pickSeat = (s: SeatChoice): Color => (s === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : s);
  const deckSize = CARD_ORDER.reduce((n, c) => n + DECK_COMPOSITION[c], 0);

  return (
    <div className="home">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Free online chess based on luck</p>
          <h1 className="logo">
            Chance <span>Chess</span>
          </h1>
          <p className="tagline">
            Chess with a twist of luck. Draw a card before every turn: double moves, teleports, wild swaps… and the odd
            cursed skip.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-primary btn-lg" href="#play">
              Play now
            </a>
            <a className="btn btn-ghost btn-lg" href="#how-to-play">
              How to play
            </a>
          </div>
        </div>
        <div className="hero-cards" aria-hidden>
          {(['skip', 'teleport', 'double', 'wild', 'undo'] as const).map((c, i) => (
            <div key={c} className={`hero-card hc-${i}`}>
              <Card card={c} size="md" />
            </div>
          ))}
        </div>
      </header>

      <section className="play" id="play" aria-labelledby="play-title">
        <div className="play-head">
          <h2 id="play-title">Choose how to play</h2>
          <div className="play-settings">
            <label className="name-field">
              <span>Your name</span>
              <input value={name} maxLength={20} placeholder="Player" onChange={(e) => onNameChange(e.target.value)} />
            </label>
            <div className="name-field">
              <span>Clock (minutes + seconds per turn)</span>
              <Segmented
                label="Clock"
                value={clock}
                onChange={setClock}
                options={Object.entries(CLOCKS).map(([k, v]) => [k, v.label])}
              />
            </div>
          </div>
        </div>
        <div className="play-label">Game mode</div>
        <div className="game-modes" role="radiogroup" aria-label="Game mode">
          {GAME_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={`mode game-mode gm-${m} ${mode === m ? 'on' : ''}`}
              onClick={() => setMode(m)}
            >
              <span className="gm-check" aria-hidden>
                <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </span>
              <ModeIcon mode={m} />
              <span className="gm-title">{MODES[m].label}</span>
              <span className="gm-blurb">{MODES[m].blurb}</span>
            </button>
          ))}
        </div>

        <div className="play-label">Play</div>
        <div className="modes">
          <article className="mode mode-ai">
            <div className="mode-icon" aria-hidden>
              <svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4.5M9 13h.01M15 13h.01M9.5 16.5h5" /><circle cx="12" cy="3.5" r="1" /></svg>
            </div>
            <h3>Play the computer</h3>
            <p>Three levels, and it plays every card too.</p>
            <Segmented
              label="Difficulty"
              value={difficulty}
              onChange={setDifficulty}
              options={(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => [d, DIFFICULTIES[d].label])}
            />
            <Segmented label="Your colour" value={aiSeat} onChange={setAiSeat} options={SEATS} />
            <button className="btn btn-primary" type="button" onClick={() => onStart({ kind: 'ai', humanColor: pickSeat(aiSeat), difficulty, rules })}>
              Start game
            </button>
          </article>

          <article className="mode mode-online">
            <div className="mode-icon" aria-hidden>
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" /></svg>
            </div>
            <h3>Play a friend online</h3>
            <p>Create a game and send the link. No sign-up.</p>
            <Segmented label="Your colour" value={onlineSeat} onChange={setOnlineSeat} options={SEATS} />
            <button className="btn btn-primary" type="button" onClick={() => onStart({ kind: 'create', seat: onlineSeat, rules })}>
              Create game
            </button>
            <form
              className="join-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (ROOM_CODE_PATTERN.test(cleanCode)) onStart({ kind: 'join', code: cleanCode });
              }}
            >
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Room code" maxLength={5} aria-label="Room code" />
              <button className="btn btn-ghost" type="submit" disabled={!ROOM_CODE_PATTERN.test(cleanCode)}>
                Join
              </button>
            </form>
          </article>

          <article className="mode mode-local">
            <div className="mode-icon" aria-hidden>
              <svg viewBox="0 0 24 24"><circle cx="8.5" cy="8" r="3" /><circle cx="16" cy="9" r="2.5" /><path d="M3 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M14.5 14.3c.5-.2 1-.3 1.5-.3 2.3 0 4.2 1.6 4.8 4.5" /></svg>
            </div>
            <h3>Pass &amp; play</h3>
            <p>Two players taking turns on this device.</p>
            <button className="btn btn-primary" type="button" onClick={() => onStart({ kind: 'local', rules })}>
              Start game
            </button>
          </article>
        </div>

        <div className="play-label">House rules</div>
        <div className="house-rules">
          <Toggle title="Check ends a Double Move" checked={checkEndsDouble} onChange={setCheckEndsDouble}>
            Giving check ends your Double Move, so a king can't be checked and captured in one turn.
          </Toggle>
          <Toggle
            title="No curses in check"
            checked={noCursedInCheck || curseRuleLocked}
            disabled={curseRuleLocked}
            onChange={setNoCursedInCheck}
          >
            Skip and Undo are never dealt while your king is in check: they're shuffled back into your deck.
            {curseRuleLocked && <em> Always on in {MODES[mode].label} mode.</em>}
          </Toggle>
        </div>
      </section>

      <section className="how" id="how-to-play" aria-labelledby="how-title">
        <h2 id="how-title">How to play Chance Chess</h2>
        <ol className="steps">
          <li>
            <span className="step-num">1</span>
            <h3>Draw a card</h3>
            <p>Before every turn, draw from your own {deckSize}-card deck. Both decks are visible in the card counter, so you can count what's left.</p>
          </li>
          <li>
            <span className="step-num">2</span>
            <h3>Play it</h3>
            <p>Move normally, move twice, teleport a piece anywhere, or swap a pawn for a piece you captured. Unless you draw a cursed Skip or Undo.</p>
          </li>
          <li>
            <span className="step-num">3</span>
            <h3>Win your way</h3>
            <p>Capture the enemy king, or checkmate it with real chess rules. In Card hand mode you can also save power cards for later. You pick the game mode before you start.</p>
          </li>
        </ol>

        <h3 className="gallery-title">Game modes</h3>
        <ul className="mode-rules">
          {GAME_MODES.map((m) => (
            <li key={m} className={`gm-${m}`}>
              <ModeIcon mode={m} />
              <h4>{MODES[m].label}</h4>
              <p>{MODES[m].rules}</p>
            </li>
          ))}
        </ul>

        <h3 className="gallery-title">The cards</h3>
        <CardGallery />
      </section>

      <section className="faq" aria-labelledby="faq-title">
        <h2 id="faq-title">Questions</h2>
        {FAQ.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>

      <footer className="footer">
        <p className="credit">
          Created by <b>{AUTHOR.name}</b>
        </p>
        <p>
          <a className="portfolio-link" href={AUTHOR.url} target="_blank" rel="author noopener">
            Portfolio website ↗
          </a>
        </p>
        <p>
          © 2026 {AUTHOR.name}. All rights reserved. A game is drawn after 200 turns, or when only the kings are left.
        </p>
        <p className="small">Chess pieces: “Celtic” set by Maurizio Monge (MIT). Fonts: Fredoka and Nunito (OFL).</p>
      </footer>
    </div>
  );
}
