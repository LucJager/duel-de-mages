import { useState } from 'react';
import type { Bonus, PlayerId, RoundResult } from '@dm/shared';
import { summarize } from '../reveal';
import { Reveal } from './Reveal';
import { ActionChip } from './Sprites';

const BONUS_NAME: Record<Bonus, string> = { fireRain: 'Pluie de feu', recharge: 'Recharge', heal: 'Soin', haste: 'Hâte' };

interface Props {
  /** De la plus ancienne à la plus récente. */
  history: RoundResult[];
  you: PlayerId;
  onClose: () => void;
}

export function History({ history, you, onClose }: Props) {
  const [replay, setReplay] = useState<RoundResult | null>(null);

  if (replay) {
    return (
      <div className="overlay">
        <Reveal key={replay.round} result={replay} you={you} onDone={() => setReplay(null)} />
        <button type="button" className="btn small replay-skip" onClick={() => setReplay(null)}>
          Passer
        </button>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel history" onClick={(e) => e.stopPropagation()}>
        <div className="history-top">
          <h2>Historique</h2>
          <button type="button" className="btn small" onClick={onClose}>
            Fermer
          </button>
        </div>
        {[...history].reverse().map((r) => {
          const lines = summarize(r);
          return (
            <section key={r.round} className="history-round">
              <div className="history-head">
                <strong>Manche {r.round}</strong>
                {r.start.bonus && <span className="tag tag-chaos">{BONUS_NAME[r.start.bonus]}</span>}
                <button type="button" className="btn small" onClick={() => setReplay(r)}>
                  Revoir
                </button>
              </div>
              {Object.entries(r.plans).map(([id, plan]) => {
                const p = r.start.players.find((o) => o.id === id)!;
                return (
                  <div key={id} className={`history-plan c${p.color}`}>
                    <span className="plan-name">{p.name}</span>
                    <span className="plan-cards">
                      {plan.map((a, i) => (
                        <span key={i} className="plan-card">
                          <ActionChip action={a} />
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
              <ul className="history-events">
                {lines.length ? lines.map((l, i) => <li key={i}>{l}</li>) : <li className="calm">Rien de notable.</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
