import { useEffect, useState } from 'react';
import { DIRS, PLANNING_MS, addPos, inBounds, slotsFor } from '@dm/shared';
import type { Action, ActionType, Dir, Pos, RoomView } from '@dm/shared';
import { socket } from '../socket';
import { bonusText, cannotAdd, cooldownLeft, dirTo, nextLavaRound, previewPlan, teleportTargets } from '../plan';
import { Board, at } from './Board';
import { History } from './History';
import { PlayerBar } from './PlayerBar';
import { ACTION_LABEL, ARROW, ActionChip, ActionIcon, IceSprite, MageSprite, TrapSprite } from './Sprites';

const PALETTE: ActionType[] = ['move', 'fireball', 'shield', 'teleport', 'trap', 'meteor', 'gust', 'ice', 'wait'];
type Picking = 'move' | 'fireball' | 'trap' | 'teleport' | 'meteor' | 'ice' | null;

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

interface Props {
  view: RoomView;
  /** Décalage horloge serveur - horloge locale. */
  offset: number;
}

export function Game({ view, offset }: Props) {
  const game = view.game!;
  const me = game.players.find((p) => p.id === view.you);
  const [plan, setPlan] = useState<Action[]>(view.myPlan ?? []);
  const [submitted, setSubmitted] = useState(!!view.myPlan);
  const [picking, setPicking] = useState<Picking>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const now = useNow(200);

  const remaining = view.deadline ? Math.max(0, view.deadline - (now + offset)) : 0;
  const secs = Math.ceil(remaining / 1000);
  const planning = view.phase === 'planning';
  const open = planning && !!me?.alive && remaining > 0;
  // Plan validé : slots et palette verrouillés jusqu'à l'annulation
  const canEdit = open && !submitted;
  const slots = slotsFor(game);

  const preview = me ? previewPlan(me.pos, game.size, plan, me.stunned, game.ice.map((i) => i.pos)) : [];
  const cur = preview.length ? preview[preview.length - 1].to : me?.pos;

  // Cases cliquables pour l'action en cours de choix
  let targets: Pos[] = [];
  if (canEdit && cur && picking) {
    if (picking === 'teleport') targets = teleportTargets(cur, game.size);
    else if (picking === 'meteor') targets = Array.from({ length: game.size ** 2 }, (_, i) => ({ x: i % game.size, y: Math.floor(i / game.size) }));
    else targets = Object.values(DIRS).map((d) => addPos(cur, d)).filter((p) => inBounds(p, game.size));
  }

  const add = (a: Action) => {
    if (!canEdit) return;
    setPlan([...plan, a]);
    setPicking(null);
    setError(null);
  };

  const pick = (type: ActionType) => {
    if (type === 'shield' || type === 'gust' || type === 'wait') add({ type });
    else setPicking(picking === type ? null : type);
  };

  const pickDir = (dir: Dir) => {
    if (picking && picking !== 'teleport' && picking !== 'meteor') add({ type: picking, dir });
  };

  const onCell = (p: Pos) => {
    if (!cur || !picking) return;
    if (picking === 'teleport') add({ type: 'teleport', dx: p.x - cur.x, dy: p.y - cur.y });
    else if (picking === 'meteor') add({ type: 'meteor', x: p.x, y: p.y });
    else {
      const dir = dirTo(cur, p);
      if (dir) pickDir(dir);
    }
  };

  const submit = () => {
    socket.emit('plan:submit', { actions: plan }, (res) => {
      if (res.ok) setSubmitted(true);
      else setError(res.error);
    });
  };

  const cancel = () => {
    socket.emit('plan:cancel', (res) => {
      if (res.ok) setSubmitted(false);
      else setError(res.error);
    });
  };

  const lava = nextLavaRound(game.round);
  const lavaMsg =
    lava === game.round ? 'La lave monte CETTE manche !' : lava && lava - game.round <= 2 ? `Lave dans ${lava - game.round} manche${lava - game.round > 1 ? 's' : ''}` : null;

  const bonus = bonusText(game);
  const ready = new Map(view.players.map((p) => [p.id, p]));

  return (
    <div className="screen game">
      <header className="game-top">
        <div className="round-badge">
          <span>Manche</span>
          <strong>{game.round}</strong>
        </div>
        <div className={`timer${planning && secs <= 5 ? ' hurry' : ''}`}>
          {planning ? (
            <>
              <strong>{secs}</strong>
              <div className="timer-bar" style={{ width: `${(remaining / PLANNING_MS) * 100}%` }} />
            </>
          ) : (
            <span className="timer-msg">Résolution…</span>
          )}
        </div>
        {view.history.length > 0 && (
          <button type="button" className="btn small hist-btn" onClick={() => setShowHistory(true)}>
            Historique
          </button>
        )}
        {bonus && <div className="chaos-banner">Chaos : {bonus}</div>}
        {lavaMsg && <div className="lava-warn">{lavaMsg}</div>}
      </header>

      <PlayerBar
        you={view.you}
        players={game.players.map((p) => ({
          ...p,
          ready: planning ? ready.get(p.id)?.ready : undefined,
          connected: ready.get(p.id)?.connected,
        }))}
      />

      <div className="board-wrap">
        <Board size={game.size} round={game.round} targets={targets} onCellClick={onCell}>
          {game.ice.map((i) => (
            <div key={`i${i.pos.x},${i.pos.y}`} className="piece ice" style={at(i.pos)}>
              <IceSprite />
            </div>
          ))}
          {game.traps.map((t) => (
            <div key={`t${t.pos.x},${t.pos.y}`} className="piece trap mine" style={at(t.pos)}>
              <TrapSprite />
            </div>
          ))}
          {me?.alive &&
            preview.map((s, i) => (
              <PreviewMark key={i} index={i} step={s} color={me.color} />
            ))}
          {game.players
            .filter((p) => p.alive)
            .map((p) => (
              <div key={p.id} className={`piece mage c${p.color}${p.id === view.you ? ' me' : ''}`} style={at(p.pos)}>
                <MageSprite color={p.color} />
                {p.stunned && <span className="stun-stars">✦✦</span>}
              </div>
            ))}
        </Board>
      </div>

      {!me?.alive ? (
        <div className="spectator">{me ? 'Tu es K.O. — place au spectacle !' : 'Mode spectateur'}</div>
      ) : (
        <div className="planner">
          {me.stunned && <p className="hint warn">Étourdi : ton prochain mouvement sera annulé !</p>}
          <div className="slots" style={{ gridTemplateColumns: `repeat(${slots}, 1fr)` }}>
            {Array.from({ length: slots }, (_, i) => {
              const a = plan[i];
              return (
                <button
                  key={i}
                  type="button"
                  className={`slot${a ? ' filled' : ''}`}
                  disabled={!canEdit || !a}
                  onClick={() => setPlan(plan.filter((_, j) => j !== i))}
                  title={a ? 'Retirer' : 'Vide'}
                >
                  <span className="slot-n">{i + 1}</span>
                  {a ? <ActionChip action={a} /> : <span className="slot-empty">?</span>}
                </button>
              );
            })}
          </div>

          {picking ? (
            <div className="picker">
              <p className="hint">
                {picking === 'teleport'
                  ? 'Touche une case en surbrillance pour te téléporter'
                  : picking === 'meteor'
                    ? 'Touche la case où faire tomber le météore'
                    : `${ACTION_LABEL[picking]} : choisis une direction`}
              </p>
              {picking !== 'teleport' && picking !== 'meteor' && (
                <div className="dpad">
                  {(['up', 'left', 'right', 'down'] as Dir[]).map((d) => (
                    <button key={d} type="button" className={`dpad-${d}`} onClick={() => pickDir(d)}>
                      {ARROW[d]}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="btn ghost small" onClick={() => setPicking(null)}>
                Annuler
              </button>
            </div>
          ) : (
            <div className="palette">
              {PALETTE.map((type) => {
                const why = canEdit ? cannotAdd(game, view.you, plan, type) : submitted ? 'Plan validé' : 'Trop tard';
                const cd = cooldownLeft(game, me, type);
                return (
                  <button
                    key={type}
                    type="button"
                    className={`action a-${type}${cd > 0 ? ' cooling' : ''}`}
                    disabled={!!why}
                    title={why ?? ACTION_LABEL[type]}
                    onClick={() => pick(type)}
                  >
                    <ActionIcon type={type} />
                    <span>{ACTION_LABEL[type]}</span>
                    {cd > 0 && (
                      <span className="cd-badge" title={`Recharge : ${cd} manche${cd > 1 ? 's' : ''}`}>
                        {cd}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {error && <p className="hint warn">{error}</p>}
          {submitted ? (
            <>
              <p className="hint ok">Plan validé ✓ En attente des autres mages…</p>
              <button type="button" className="btn" disabled={!open} onClick={cancel}>
                Annuler ma validation
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" disabled={!canEdit || plan.length !== slots} onClick={submit}>
              {plan.length === slots ? 'Valider' : `Valider (${plan.length}/${slots})`}
            </button>
          )}
        </div>
      )}

      {showHistory && <History history={view.history} you={view.you} onClose={() => setShowHistory(false)} />}
    </div>
  );
}

function PreviewMark({ step, index, color }: { step: ReturnType<typeof previewPlan>[number]; index: number; color: number }) {
  const n = index + 1;
  if (step.fireball) {
    return (
      <>
        {step.fireball.map((p, j) => (
          <div key={j} className={`piece ghost-fire dir-${step.action.type === 'fireball' ? step.action.dir : ''}`} style={at(p)}>
            {j === 0 && <span className="ghost-n">{n}</span>}
          </div>
        ))}
      </>
    );
  }
  if (step.meteor) {
    return (
      <div className="piece ghost-meteor" style={at(step.meteor)}>
        <span className="ghost-n">{n}</span>
      </div>
    );
  }
  if (step.ice) {
    return (
      <div className="piece ghost-ice" style={at(step.ice)}>
        <span className="ghost-n">{n}</span>
      </div>
    );
  }
  if (step.gust) {
    return (
      <div className="piece ghost-gust" style={at(step.from)}>
        <span className="ghost-n">{n}</span>
      </div>
    );
  }
  if (step.trap) {
    return (
      <div className="piece ghost-trap" style={at(step.trap)}>
        <span className="ghost-n">{n}</span>
      </div>
    );
  }
  if (step.blocked) {
    return (
      <div className="piece ghost-blocked" style={at(step.from)}>
        <span className="ghost-n">{n}</span>
      </div>
    );
  }
  if (step.to !== step.from) {
    return (
      <div className={`piece ghost-mage c${color}${step.action.type === 'teleport' ? ' tp' : ''}`} style={at(step.to)}>
        <MageSprite color={color} />
        <span className="ghost-n">{n}</span>
      </div>
    );
  }
  return null;
}
