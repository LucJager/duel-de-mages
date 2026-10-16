import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, RoomView, RoundResult } from '@dm/shared';
import { isMuted, setMuted } from './audio';
import { socket } from './socket';
import { getToken, load, save } from './storage';
import { Game } from './components/Game';
import { GameOver } from './components/GameOver';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Reveal } from './components/Reveal';

const token = getToken();

const codeFromPath = () => location.pathname.match(/^\/r\/([a-z]{4})\/?$/i)?.[1].toUpperCase() ?? null;

function setPath(path: string) {
  if (location.pathname !== path) history.pushState(null, '', path);
}

export function App() {
  const [urlCode, setUrlCode] = useState(codeFromPath);
  const [name, setNameState] = useState(load('dm-name') ?? '');
  const [view, setView] = useState<RoomView | null>(null);
  const [offset, setOffset] = useState(0);
  const [reveal, setReveal] = useState<{ before: GameState; result: RoundResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [muted, setMutedState] = useState(isMuted());

  // Salle rejointe : sert à la reprise automatique après reconnexion / rechargement
  const joined = useRef<string | null>(sessionStorage.getItem('dm-room') === urlCode ? urlCode : null);
  // Dernier état de partie vu en planification = état AVANT la manche résolue
  const planningGame = useRef<GameState | null>(null);
  const nameRef = useRef(name);

  const setName = (n: string) => {
    setNameState(n);
    nameRef.current = n;
    save('dm-name', n);
  };

  const enterRoom = useCallback((code: string) => {
    joined.current = code;
    sessionStorage.setItem('dm-room', code);
    setPath(`/r/${code}`);
    setUrlCode(code);
    setError(null);
  }, []);

  const join = useCallback(
    (code: string) => {
      setBusy(true);
      socket.emit('room:join', { code, name: nameRef.current.trim(), token }, (res) => {
        setBusy(false);
        if (res.ok) return enterRoom(code);
        joined.current = null;
        sessionStorage.removeItem('dm-room');
        setError(res.error);
      });
    },
    [enterRoom],
  );

  const create = () => {
    setBusy(true);
    socket.emit('room:create', { name: name.trim(), token }, (res) => {
      setBusy(false);
      if (res.ok) enterRoom(res.code);
      else setError(res.error);
    });
  };

  const leave = useCallback(() => {
    socket.emit('room:leave');
    joined.current = null;
    sessionStorage.removeItem('dm-room');
    planningGame.current = null;
    setView(null);
    setReveal(null);
    setUrlCode(null);
    setPath('/');
  }, []);

  useEffect(() => {
    const onState = (v: RoomView) => {
      setOffset(v.serverNow - Date.now());
      if (v.phase === 'planning' && v.game) planningGame.current = v.game;
      setView(v);
    };
    const onResult = (r: RoundResult) => {
      const before = planningGame.current;
      if (before && before.round === r.round) setReveal({ before, result: r });
    };
    const onConnect = () => {
      if (joined.current) join(joined.current);
    };
    socket.on('room:state', onState);
    socket.on('round:result', onResult);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('room:state', onState);
      socket.off('round:result', onResult);
      socket.off('connect', onConnect);
    };
  }, [join]);

  // Bouton « précédent » du navigateur
  useEffect(() => {
    const onPop = () => {
      const code = codeFromPath();
      if (joined.current && code !== joined.current) leave();
      setUrlCode(code);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [leave]);

  const toggleMute = () => {
    setMuted(!muted);
    setMutedState(!muted);
  };

  const endReveal = useCallback(() => setReveal(null), []);

  let screen;
  if (!view) {
    screen = (
      <Home
        key={urlCode ?? ''}
        name={name}
        setName={setName}
        urlCode={urlCode}
        error={error}
        busy={busy}
        onCreate={create}
        onJoin={join}
        onHome={() => {
          setError(null);
          setUrlCode(null);
          setPath('/');
        }}
      />
    );
  } else if (reveal) {
    screen = <Reveal key={reveal.result.round} before={reveal.before} result={reveal.result} you={view.you} onDone={endReveal} />;
  } else if (view.phase === 'lobby' || !view.game) {
    screen = <Lobby view={view} onLeave={leave} />;
  } else if (view.phase === 'over') {
    screen = <GameOver view={view} onLeave={leave} />;
  } else {
    screen = <Game key={view.game.round} view={view} offset={offset} />;
  }

  return (
    <div className="app">
      <button type="button" className="mute" onClick={toggleMute} aria-label={muted ? 'Activer le son' : 'Couper le son'}>
        {muted ? 'Son : off' : 'Son : on'}
      </button>
      {screen}
    </div>
  );
}
