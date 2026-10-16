import { MAX_HP } from '@dm/shared';
import type { PlayerId } from '@dm/shared';
import { MageSprite } from './Sprites';

export interface BarPlayer {
  id: PlayerId;
  name: string;
  color: number;
  hp: number;
  alive: boolean;
  /** undefined = pas d'indicateur. */
  ready?: boolean;
  connected?: boolean;
}

export function PlayerBar({ players, you }: { players: BarPlayer[]; you: PlayerId }) {
  return (
    <ul className="player-bar">
      {players.map((p) => (
        <li key={p.id} className={`pcard c${p.color}${p.alive ? '' : ' ko'}`}>
          <span className="pcard-face">
            <MageSprite color={p.color} />
          </span>
          <span className="pcard-body">
            <span className="pcard-name">
              {p.name}
              {p.id === you && <em> (toi)</em>}
            </span>
            <span className="hearts" aria-label={`${p.hp} PV`}>
              {Array.from({ length: MAX_HP }, (_, i) => (
                <span key={i} className={i < p.hp ? 'heart' : 'heart empty'}>♥</span>
              ))}
            </span>
          </span>
          {!p.alive ? (
            <span className="tag tag-ko">K.O.</span>
          ) : p.connected === false ? (
            <span className="tag tag-off">absent</span>
          ) : p.ready !== undefined ? (
            <span className={`tag ${p.ready ? 'tag-ready' : 'tag-wait'}`}>{p.ready ? 'prêt' : '…'}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
