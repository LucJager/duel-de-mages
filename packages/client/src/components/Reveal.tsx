import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { DIRS, samePos } from '@dm/shared';
import type { GameEvent, PlayerId, RoundResult } from '@dm/shared';
import { play } from '../audio';
import type { Sfx } from '../audio';
import { EVENT_DELAY, OUTRO_MS, PLANS_MS, STEP_MS, applyStep, displayFrom } from '../reveal';
import { Board, at } from './Board';
import { PlayerBar } from './PlayerBar';
import { ActionChip, IceSprite, Img, MageSprite, MeteorSprite, TrapSprite } from './Sprites';

const SFX: Partial<Record<GameEvent['type'], Sfx>> = {
  fireball: 'fireball',
  bonk: 'bonk',
  shield: 'shield',
  trapTriggered: 'trap',
  death: 'death',
  meteor: 'meteor',
  gust: 'gust',
  icePlaced: 'ice',
};

interface Props {
  result: RoundResult;
  you: PlayerId;
  onDone: () => void;
}

export function Reveal({ result, you, onDone }: Props) {
  const before = result.start;
  // -1 = présentation des plans, puis index du step joué
  const [stage, setStage] = useState(-1);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  // displays[i] = état affiché avant le step i
  const displays = useMemo(() => {
    const out = [displayFrom(result.start)];
    for (const step of result.steps) out.push(applyStep(out[out.length - 1], step));
    return out;
  }, [result]);

  useEffect(() => {
    const timers: number[] = [];
    result.steps.forEach((events, i) => {
      const t0 = PLANS_MS + i * STEP_MS;
      timers.push(window.setTimeout(() => setStage(i), t0));
      const played = new Set<Sfx>();
      for (const e of events) {
        const sfx = SFX[e.type];
        if (!sfx || played.has(sfx)) continue;
        played.add(sfx);
        timers.push(window.setTimeout(() => play(sfx), t0 + EVENT_DELAY[e.type]));
      }
    });
    timers.push(window.setTimeout(() => done.current(), PLANS_MS + result.steps.length * STEP_MS + OUTRO_MS));
    return () => timers.forEach(clearTimeout);
  }, [result]);

  const step = stage >= 0 ? result.steps[stage] : [];
  const prev = displays[Math.max(stage, 0)];
  const cur = displays[stage + 1] ?? prev;
  const hit = step.some((e) => e.type === 'damage');
  const names = new Map(before.players.map((p) => [p.id, p]));
  const posOf = (id: PlayerId) => cur.mages[id].pos;

  const fx: ReactNode[] = [];
  step.forEach((e, k) => {
    const d = { '--d': `${EVENT_DELAY[e.type]}ms` } as CSSProperties;
    const key = `${stage}-${k}`;
    switch (e.type) {
      case 'shield':
        fx.push(
          <div key={key} className="piece fx-shield" style={at(posOf(e.player), d)}>
            <Img className="sprite" src="/assets/shield.png" alt="" fallback={<span className="shield-ring" />} />
          </div>,
        );
        break;
      case 'bonk':
        fx.push(<Bubble key={key} pos={e.at} style={d} text="BONK !" kind="bonk" />);
        break;
      case 'wall':
        fx.push(<Bubble key={key} pos={e.at} style={d} text="PAF !" kind="wall" />);
        break;
      case 'stunned':
        fx.push(<Bubble key={key} pos={posOf(e.player)} style={d} text="Étourdi !" kind="stun" />);
        break;
      case 'move':
        if (e.kind === 'teleport') fx.push(<div key={key} className="piece fx-puff" style={at(e.from, d)} />);
        break;
      case 'gust':
        fx.push(<div key={key} className="piece fx-gust" style={at(prev.mages[e.player].pos, d)} />);
        break;
      case 'icePlaced':
        fx.push(<div key={key} className="piece fx-frost" style={at(e.at, d)} />);
        break;
      case 'iceMelted':
        fx.push(
          <div key={key} className="piece ice fx-melt" style={at(e.at, d)}>
            <IceSprite />
          </div>,
        );
        break;
      case 'meteor':
        fx.push(
          <div key={key} className="piece fx-meteor" style={at(e.at, d)}>
            <div className="fx-meteor-rock">
              <MeteorSprite />
            </div>
            <div className="fx-meteor-boom" />
          </div>,
        );
        break;
      case 'trapTriggered':
        fx.push(
          <div key={key} className="piece fx-trap" style={at(e.at, d)}>
            <TrapSprite />
          </div>,
          <Bubble key={`${key}b`} pos={e.at} style={d} text="CLAC !" kind="trap" />,
        );
        break;
      case 'fireball': {
        const shooter = posOf(e.player);
        const v = DIRS[e.dir];
        const len = e.path.length;
        e.path.forEach((p, j) =>
          fx.push(
            <div key={`${key}-${j}`} className="piece fx-beam" style={at(p, { '--d': `${EVENT_DELAY.fireball + j * 45}ms` } as CSSProperties)} />,
          ),
        );
        if (len)
          fx.push(
            <div key={key} className="piece fx-fire-wrap" style={at(shooter)}>
              <div
                className={`fx-fire dir-${e.dir}`}
                style={{ ...d, '--tx': v.x * len, '--ty': v.y * len } as CSSProperties}
              >
                <Img className="sprite" src="/assets/fireball.png" alt="" fallback={<span className="fire-dot" />} />
              </div>
            </div>,
          );
        break;
      }
      case 'lava':
        fx.push(<div key={key} className="piece fx-lava" style={at(e.at, d)} />);
        break;
      case 'damage':
        fx.push(<Bubble key={key} pos={posOf(e.player)} style={d} text={`-${e.amount}`} kind="dmg" />);
        break;
      case 'shieldBlock':
        fx.push(<Bubble key={key} pos={posOf(e.player)} style={d} text="BLOQUÉ !" kind="block" />);
        break;
      case 'death':
        fx.push(<div key={key} className="piece fx-smoke" style={at(posOf(e.player), d)} />);
        break;
    }
  });

  const hurt = new Set(step.flatMap((e) => (e.type === 'damage' ? [e.player] : [])));
  const teleported = new Set(step.flatMap((e) => (e.type === 'move' && e.kind === 'teleport' ? [e.player] : [])));
  const pushed = new Set(step.flatMap((e) => (e.type === 'move' && e.kind === 'push' ? [e.player] : [])));
  const placed = step.flatMap((e) => (e.type === 'icePlaced' ? [e.at] : []));
  const shooters = Object.keys(result.plans);

  return (
    <div className="screen game reveal">
      <header className="game-top">
        <div className="round-badge">
          <span>Manche</span>
          <strong>{result.round}</strong>
        </div>
        <div className="reveal-title" key={stage}>
          {stage < 0 ? 'Révélation !' : `Action ${stage + 1} / ${result.steps.length}`}
        </div>
      </header>

      <PlayerBar
        you={you}
        players={before.players.map((p) => ({ id: p.id, name: p.name, color: p.color, hp: cur.mages[p.id].hp, alive: cur.mages[p.id].alive }))}
      />

      <div className="board-wrap">
        <Board
          size={before.size}
          round={before.round}
          // Deux classes alternées pour relancer l'animation sans remonter l'arène
          className={hit ? `shake${stage % 2}` : ''}
        >
          {cur.ice.map((p) => (
            <div
              key={`i${p.x},${p.y}`}
              className={`piece ice${placed.some((q) => samePos(q, p)) ? ' ice-in' : ''}`}
              style={at(p, { '--d': `${EVENT_DELAY.icePlaced}ms` } as CSSProperties)}
            >
              <IceSprite />
            </div>
          ))}
          {cur.traps.map((t) => (
            <div key={`t${t.pos.x},${t.pos.y}`} className="piece trap mine" style={at(t.pos)}>
              <TrapSprite />
            </div>
          ))}
          {before.players
            .filter((p) => prev.mages[p.id].alive)
            .map((p) => {
              const m = cur.mages[p.id];
              const tp = teleported.has(p.id);
              return (
                <div
                  key={tp ? `${p.id}-tp-${stage}` : p.id}
                  className={`piece mage c${p.color}${p.id === you ? ' me' : ''}${tp ? ' tp-in' : ''}${pushed.has(p.id) ? ' pushed' : ''}${hurt.has(p.id) ? ' hurt' : ''}${m.alive ? '' : ' dying'}`}
                  style={at(m.pos)}
                >
                  <MageSprite color={p.color} />
                </div>
              );
            })}
          {fx}
        </Board>
      </div>

      <div className="plans">
        {shooters.map((id) => {
          const p = names.get(id)!;
          return (
            <div key={id} className={`plan-row c${p.color}`}>
              <span className="plan-name">{p.name}</span>
              <span className="plan-cards">
                {result.plans[id].map((a, i) => (
                  <span
                    key={i}
                    className={`plan-card${i === stage ? ' current' : ''}${i < stage ? ' past' : ''}`}
                    style={{ animationDelay: `${i * 120}ms` }}
                  >
                    <ActionChip action={a} />
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Bubble({ pos, text, kind, style }: { pos: { x: number; y: number }; text: string; kind: string; style: CSSProperties }) {
  return (
    <div className={`piece bubble b-${kind}`} style={at(pos, style)}>
      <span>{text}</span>
    </div>
  );
}
