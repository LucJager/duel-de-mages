import { useEffect, useState } from 'react';
import type { RoomView } from '@dm/shared';
import { play } from '../audio';
import { socket } from '../socket';
import { MageSprite } from './Sprites';

export function GameOver({ view, onLeave }: { view: RoomView; onLeave: () => void }) {
  const game = view.game!;
  const winner = game.players.find((p) => p.id === game.winner);
  const losers = game.players.filter((p) => p.id !== game.winner);
  const isHost = view.hostId === view.you;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    play('victory');
  }, []);

  const rematch = () => socket.emit('game:rematch', (res) => !res.ok && setError(res.error));

  return (
    <div className="screen over">
      <div className="confetti" aria-hidden />
      <h2 className="over-title">
        {winner ? (
          <>
            Victoire de <span className={`name c${winner.color}`}>{winner.name}</span> !
          </>
        ) : (
          'Égalité !'
        )}
      </h2>
      <p className="tagline">
        {winner ? (winner.id === view.you ? 'Tu es le mage suprême.' : 'Ce sera pour la revanche…') : 'Tout le monde a fini en cendres.'}
      </p>

      <div className="podium">
        {winner && (
          <div className={`podium-spot first c${winner.color}`}>
            <span className="crown">♛</span>
            <MageSprite color={winner.color} />
            <span className="podium-name">{winner.name}</span>
            <span className="podium-block">1</span>
          </div>
        )}
        {losers.map((p) => (
          <div key={p.id} className={`podium-spot c${p.color}${winner ? ' ko' : ''}`}>
            <MageSprite color={p.color} />
            <span className="podium-name">{p.name}</span>
            <span className="podium-block">{winner ? 'K.O.' : '='}</span>
          </div>
        ))}
      </div>

      <div className="over-actions">
        {isHost ? (
          <button type="button" className="btn primary big" onClick={rematch}>
            Revanche !
          </button>
        ) : (
          <p className="hint">L'hôte peut lancer une revanche.</p>
        )}
        {error && <p className="hint warn">{error}</p>}
        <button type="button" className="btn ghost" onClick={onLeave}>
          Retour à l'accueil
        </button>
      </div>
    </div>
  );
}
