import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mode, RoomView, RoundResult } from '@dm/shared';
import { isMuted, setMuted } from './audio';
import { socket } from './socket';
import { getToken, load, save, sessionRoom } from './storage';
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
  const [reveal, setReveal] = useState<RoundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [muted, setMutedState] = useState(isMuted());

  // Salle rejointe : sert à la reprise automatique après reconnexion / rechargement
  const joined = useRef<string | null>(sessionRoom() === urlCode ? urlCode : null);
  // Salle quittée : on ignore les room:state encore en route
  const leftCode = useRef<string | null>(null);
  const nameRef = useRef(name);

  const setName = (n: string) => {
    setNameState(n);
    nameRef.current = n;
    save('dm-name', n);
  };

  const enterRoom = useCallback((code: string) => {
    joined.current = code;
    sessionRoom(code);
    setPath(`/r/${code}`);
    setUrlCode(code);
    setError(null);
  }, []);

  const join = useCallback(
    (code: string) => {
      setBusy(true);
      leftCode.current = null;
      socket.emit('room:join', { code, name: nameRef.current.trim(), token }, (res) => {
        setBusy(false);
        if (res.ok) return enterRoom(code);
        joined.current = null;
        sessionRoom(null);
        setView(null);
        setReveal(null);
        setError(res.error);
      });
    },
    [enterRoom],
  );

  const create = (mode: Mode) => {
    setBusy(true);
    leftCode.current = null;
    socket.emit('room:create', { name: name.trim(), token, mode }, (res) => {
      setBusy(false);
      if (res.ok) enterRoom(res.code);
      else setError(res.error);
    });
  };

  const leave = useCallback(() => {
    socket.emit('room:leave');
    leftCode.current = joined.current;
    joined.current = null;
    sessionRoom(null);
    setView(null);
    setReveal(null);
    setUrlCode(null);
    setPath('/');
  }, []);

  useEffect(() => {
    const onState = (v: RoomView) => {
      if (v.code === leftCode.current) return;
      setOffset(v.serverNow - Date.now());
      if (v.phase === 'planning' && v.game) {
        // Révélation périmée (onglet gelé en arrière-plan) : on la coupe
        const round = v.game.round;
        setReveal((r) => (r && r.round < round ? null : r));
      }
      setView(v);
    };
    const onResult = (r: RoundResult) => setReveal(r);
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
    screen = <Reveal key={reveal.round} result={reveal} you={view.you} onDone={endReveal} />;
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
