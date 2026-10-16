import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS } from '@dm/shared';
import type { RoomView } from '@dm/shared';
import { socket } from '../socket';
import { MageSprite } from './Sprites';

export function Lobby({ view, onLeave }: { view: RoomView; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = `${location.origin}/r/${view.code}`;
  const isHost = view.hostId === view.you;
  const n = view.players.length;
  const canStart = n >= MIN_PLAYERS && n <= MAX_PLAYERS;

  const copy = () => {
    navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  const start = () => socket.emit('game:start', (res) => !res.ok && setError(res.error));

  return (
    <div className="screen lobby">
      <div className="panel lobby-panel">
        <p className="kicker">Salle</p>
        <h2 className="room-code">{view.code}</h2>
        <div className="share">
          <code>{link.replace(/^https?:\/\//, '')}</code>
          <button type="button" className="btn small" onClick={copy}>
            {copied ? 'Copié !' : 'Copier le lien'}
          </button>
        </div>

        <ul className="lobby-players">
          {view.players.map((p, i) => (
            <li key={p.id} className={`c${p.color}${p.connected ? '' : ' off'}`} style={{ animationDelay: `${i * 90}ms` }}>
              <span className="lobby-face">
                <MageSprite color={p.color} />
              </span>
              <span className="lobby-name">
                {p.name}
                {p.id === view.you && <em> (toi)</em>}
              </span>
              {p.id === view.hostId && <span className="tag tag-host">hôte</span>}
            </li>
          ))}
          {Array.from({ length: MAX_PLAYERS - n }, (_, i) => (
            <li key={`empty${i}`} className="empty">
              <span className="lobby-face" />
              <span className="lobby-name">En attente d'un mage…</span>
            </li>
          ))}
        </ul>

        {isHost ? (
          <button type="button" className="btn primary big" disabled={!canStart} onClick={start}>
            {canStart ? 'Lancer le duel !' : `Il faut au moins ${MIN_PLAYERS} mages`}
          </button>
        ) : (
          <p className="hint">L'hôte lancera la partie quand tout le monde sera là.</p>
        )}
        {error && <p className="hint warn">{error}</p>}
        <button type="button" className="btn ghost small" onClick={onLeave}>
          Quitter la salle
        </button>
      </div>
    </div>
  );
}
