import { useState } from 'react';
import { type Color, type GameRules, DECK_COMPOSITION, CARD_ORDER, CARDS, DEFAULT_RULES } from '../../engine';
import { DIFFICULTIES, type Difficulty } from '../../engine/ai';
import { ROOM_CODE_PATTERN, type SeatChoice } from '../../shared/protocol';
import { RulesList } from './Panels';

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

const SEATS: [SeatChoice, string][] = [
  ['w', 'White'],
  ['random', 'Random'],
  ['b', 'Black'],
];

export function Home({ name, onNameChange, onStart }: HomeProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [aiSeat, setAiSeat] = useState<SeatChoice>('w');
  const [onlineSeat, setOnlineSeat] = useState<SeatChoice>('random');
  const [code, setCode] = useState('');
  const [checkEndsDouble, setCheckEndsDouble] = useState(DEFAULT_RULES.checkEndsDoubleMove);

  const rules: GameRules = { checkEndsDoubleMove: checkEndsDouble };
  const cleanCode = code.trim().toUpperCase();
  const pickSeat = (s: SeatChoice): Color => (s === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : s);
  const deckSize = CARD_ORDER.reduce((n, c) => n + DECK_COMPOSITION[c], 0);

  return (
    <div className="home">
      <header className="hero">
        <h1>
          <span aria-hidden>♞</span> Chance Chess
        </h1>
        <p>Chess with a twist of luck: draw a card before every turn.</p>
      </header>

      <label className="name-field">
        Your name
        <input value={name} maxLength={20} placeholder="Player" onChange={(e) => onNameChange(e.target.value)} />
      </label>

      <div className="modes">
        <section className="mode">
          <h2>Play the computer</h2>
          <Segmented
            label="Difficulty"
            value={difficulty}
            onChange={setDifficulty}
            options={(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => [d, DIFFICULTIES[d].label])}
          />
          <Segmented label="Your colour" value={aiSeat} onChange={setAiSeat} options={SEATS} />
          <button className="btn" type="button" onClick={() => onStart({ kind: 'ai', humanColor: pickSeat(aiSeat), difficulty, rules })}>
            Start game
          </button>
        </section>

        <section className="mode">
          <h2>Play a friend online</h2>
          <Segmented label="Your colour" value={onlineSeat} onChange={setOnlineSeat} options={SEATS} />
          <button className="btn" type="button" onClick={() => onStart({ kind: 'create', seat: onlineSeat, rules })}>
            Create game &amp; get link
          </button>
          <form
            className="join-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (ROOM_CODE_PATTERN.test(cleanCode)) onStart({ kind: 'join', code: cleanCode });
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Room code"
              maxLength={5}
              aria-label="Room code"
            />
            <button className="btn secondary" type="submit" disabled={!ROOM_CODE_PATTERN.test(cleanCode)}>
              Join
            </button>
          </form>
        </section>

        <section className="mode">
          <h2>Pass &amp; play</h2>
          <p className="muted small">Two players taking turns on this device.</p>
          <button className="btn" type="button" onClick={() => onStart({ kind: 'local', rules })}>
            Start game
          </button>
        </section>
      </div>

      <section className="rules">
        <h2>How to play</h2>
        <p>
          Normal chess rules, except: <b>before every turn you draw a card</b> that decides what you can do. Each player has
          their own {deckSize}-card deck, so you can count what's left. <b>Win by capturing the enemy king</b>: there is no
          checkmate, so watch out for a king left under attack when your opponent might draw a good card (or you draw a bad
          one).
        </p>
        <RulesList />
        <p className="muted small">
          Deck: {CARD_ORDER.map((c) => `${DECK_COMPOSITION[c]}× ${CARDS[c].name}`).join(', ')}. A game is drawn after 200
          turns, or if only the kings are left.
        </p>
        <label className="toggle">
          <input type="checkbox" checked={checkEndsDouble} onChange={(e) => setCheckEndsDouble(e.target.checked)} />
          House rule: giving check ends a Double Move (so a king can't be checked and captured in one turn)
        </label>
      </section>
    </div>
  );
}
