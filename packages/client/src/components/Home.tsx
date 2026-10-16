import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Mode } from '@dm/shared';
import { Img } from './Sprites';

interface Props {
  name: string;
  setName: (n: string) => void;
  /** Code de salle présent dans l'URL (/r/CODE). */
  urlCode: string | null;
  error: string | null;
  busy: boolean;
  onCreate: (mode: Mode) => void;
  onJoin: (code: string) => void;
  onHome: () => void;
}

export function Home({ name, setName, urlCode, error, busy, onCreate, onJoin, onHome }: Props) {
  const [code, setCode] = useState(urlCode ?? '');
  const [mode, setMode] = useState<Mode>('classic');
  const okName = name.trim().length > 0;
  const okCode = /^[A-Z]{4}$/.test(code);

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (okName && okCode) onJoin(code);
  };

  return (
    <div className="screen home">
      <div className="home-hero">
        <Img className="logo" src="/assets/logo.png" alt="Duel de Mages" fallback={<h1 className="logo-text">Duel de Mages</h1>} />
        <p className="tagline">Trois sorts. Trente secondes. Zéro pitié.</p>
      </div>

      <form className="panel home-panel" onSubmit={join}>
        <label className="field">
          <span>Ton nom de mage</span>
          <input
            value={name}
            maxLength={16}
            placeholder="Merlin le Flou"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {urlCode ? (
          <>
            <p className="invite">
              On t'attend dans la salle <strong>{urlCode}</strong> !
            </p>
            <button className="btn primary big" disabled={!okName || busy}>
              Rejoindre le duel
            </button>
            <button type="button" className="btn ghost small" onClick={onHome}>
              Autre salle
            </button>
          </>
        ) : (
          <>
            <div className="mode-switch" role="radiogroup" aria-label="Mode de jeu">
              {(['classic', 'chaos'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  className={mode === m ? 'on' : ''}
                  onClick={() => setMode(m)}
                >
                  <strong>{m === 'chaos' ? 'Chaos' : 'Classique'}</strong>
                  <span>{m === 'chaos' ? 'Un bonus surprise par manche' : 'Les règles pures'}</span>
                </button>
              ))}
            </div>
            <button type="button" className="btn primary big" disabled={!okName || busy} onClick={() => onCreate(mode)}>
              Créer une salle
            </button>
            <div className="or">ou</div>
            <div className="join-row">
              <input
                className="code-input"
                value={code}
                maxLength={4}
                placeholder="CODE"
                aria-label="Code de la salle"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              />
              <button className="btn" disabled={!okName || !okCode || busy}>
                Rejoindre
              </button>
            </div>
          </>
        )}
        {error && <p className="hint warn">{error}</p>}
      </form>

      <details className="panel rules">
        <summary>Comment on joue ?</summary>
        <ul>
          <li>Chaque manche, tu as <b>30 secondes</b> pour planifier en secret <b>3 actions</b>, puis tu valides.</li>
          <li>Puis tout le monde agit <b>en même temps</b>, action par action. Surprise !</li>
          <li><b>Boule de feu</b> : rayon en ligne droite (2 max par manche). <b>Piège</b> : invisible pour les autres, 1 dégât et bloque le prochain mouvement.</li>
          <li><b>Bouclier</b> : annule les dégâts de l'action. <b>Téléport</b> : saute jusqu'à 2 cases.</li>
          <li><b>Météore</b> : 1 dégât sur la case de ton choix, n'importe où (même sur toi !). <b>Bourrasque</b> : repousse d'une case les mages collés à toi.</li>
          <li><b>Glace</b> : un bloc sur la case voisine qui arrête mouvements et boules de feu ; il fond à la fin de la manche suivante.</li>
          <li>Bouclier, téléport, météore, bourrasque et glace : <b>1 fois par manche</b>, puis une manche de recharge (le chiffre sur le bouton).</li>
          <li>Deux mages sur la même case ? <b>BONK !</b> Personne ne bouge.</li>
          <li>Dès la manche 6, la <b>lave</b> grignote l'arène : -1 PV si tu finis la manche dessus. Dernier mage debout = gagnant (3 PV chacun).</li>
          <li><b>Mode Chaos</b> : chaque manche, un bonus pour tous — Pluie de feu (3 boules de feu), Recharge (aucune recharge), Soin (+1 PV) ou Hâte (4 actions).</li>
        </ul>
      </details>
    </div>
  );
}
