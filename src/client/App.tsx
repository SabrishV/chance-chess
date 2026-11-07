import { useEffect, useState } from 'react';
import { randomRoomCode } from '../shared/protocol';
import { useLocalGame, useOnlineGame } from './controllers';
import { GameScreen } from './components/GameScreen';
import { Home, type StartRequest } from './components/Home';
import { type Screen, screenFromUrl } from './screens';
import { loadValue, saveValue } from './storage';

export function App() {
  const [screen, setScreen] = useState<Screen>(screenFromUrl);
  // The pre-rendered home page has an empty name field; fill it in after hydrating.
  const [name, setName] = useState(() => (screen.kind === 'home' ? '' : loadValue('cc:name', '')));

  useEffect(() => {
    setName((n) => n || loadValue('cc:name', ''));
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen.kind]);

  useEffect(() => {
    const onPop = () => setScreen(screenFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const updateName = (n: string) => {
    setName(n);
    saveValue('cc:name', n);
  };

  const goHome = () => {
    if (window.location.search) window.history.pushState(null, '', '/');
    setScreen({ kind: 'home' });
  };

  const start = (req: StartRequest) => {
    switch (req.kind) {
      case 'ai':
        setScreen({ kind: 'local', id: Date.now(), mode: 'ai', humanColor: req.humanColor, difficulty: req.difficulty, rules: req.rules });
        break;
      case 'local':
        setScreen({ kind: 'local', id: Date.now(), mode: 'local', humanColor: 'w', difficulty: 'medium', rules: req.rules });
        break;
      case 'create':
      case 'join': {
        const code = req.kind === 'create' ? randomRoomCode() : req.code;
        window.history.pushState(null, '', `/?room=${code}`);
        setScreen(req.kind === 'create' ? { kind: 'online', code, seat: req.seat, rules: req.rules } : { kind: 'online', code });
        break;
      }
    }
  };

  if (screen.kind === 'local') {
    return <LocalGame key={screen.id} {...screen} playerName={name} onLeave={goHome} />;
  }
  if (screen.kind === 'online') {
    if (!name.trim()) return <NamePrompt onSubmit={updateName} onCancel={goHome} />;
    return <OnlineGame key={screen.code} {...screen} playerName={name.trim()} onLeave={goHome} />;
  }
  return <Home name={name} onNameChange={updateName} onStart={start} />;
}

function LocalGame(props: Extract<Screen, { kind: 'local' }> & { playerName: string; onLeave: () => void }) {
  const game = useLocalGame(props);
  return <GameScreen game={game} onLeave={props.onLeave} />;
}

function OnlineGame(props: Extract<Screen, { kind: 'online' }> & { playerName: string; onLeave: () => void }) {
  const game = useOnlineGame(props);
  return <GameScreen game={game} roomCode={props.code} onLeave={props.onLeave} />;
}

function NamePrompt({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="center-screen">
      <form
        className="mode"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <h2>Join a game of Chance Chess</h2>
        <label className="name-field">
          Your name
          <input autoFocus value={value} maxLength={20} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button className="btn" type="submit" disabled={!value.trim()}>
          Join
        </button>
        <button className="btn secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </div>
  );
}
