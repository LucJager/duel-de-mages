import { useState } from 'react';
import type { FormEvent } from 'react';
import { Img } from './Sprites';

interface Props {
  name: string;
  setName: (n: string) => void;
  /** Code de salle présent dans l'URL (/r/CODE). */
  urlCode: string | null;
  error: string | null;
  busy: boolean;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onHome: () => void;
}

export function Home({ name, setName, urlCode, error, busy, onCreate, onJoin, onHome }: Props) {
  const [code, setCode] = useState(urlCode ?? '');
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
            <button type="button" className="btn primary big" disabled={!okName || busy} onClick={onCreate}>
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
          <li>Chaque manche, tu as <b>30 secondes</b> pour planifier en secret <b>3 actions</b>.</li>
          <li>Puis tout le monde agit <b>en même temps</b>, action par action. Surprise !</li>
          <li><b>Boule de feu</b> : rayon en ligne droite (2 max par manche). <b>Bouclier</b> : annule les dégâts de l'action (1 par manche).</li>
          <li><b>Téléport</b> : saute jusqu'à 2 cases (une manche de recharge). <b>Piège</b> : invisible pour les autres, 1 dégât et bloque le prochain mouvement.</li>
          <li>Deux mages sur la même case ? <b>BONK !</b> Personne ne bouge.</li>
          <li>Dès la manche 6, la <b>lave</b> grignote l'arène. Dernier mage debout = gagnant (3 PV chacun).</li>
        </ul>
      </details>
    </div>
  );
}
