import { useState } from 'react';
import type { ReactNode } from 'react';
import { COLORS } from '@dm/shared';
import type { ActionType, Dir, RevealedAction } from '@dm/shared';

/** Image avec rendu de secours si le fichier manque. */
export function Img({ src, alt, fallback, className }: { src: string; alt: string; fallback: ReactNode; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <>{fallback}</>;
  return <img className={className} src={src} alt={alt} draggable={false} onError={() => setBroken(true)} />;
}

export function MageSprite({ color }: { color: number }) {
  return (
    <Img
      className="sprite"
      src={`/assets/mage-${COLORS[color]}.png`}
      alt=""
      fallback={<span className={`mage-dot c${color}`} />}
    />
  );
}

export function TrapSprite() {
  return <Img className="sprite" src="/assets/trap.png" alt="" fallback={<span className="trap-dot" />} />;
}

export const ACTION_LABEL: Record<ActionType, string> = {
  move: 'Bouger',
  fireball: 'Boule de feu',
  shield: 'Bouclier',
  teleport: 'Téléport',
  trap: 'Piège',
  wait: 'Attendre',
};

const GLYPH: Record<ActionType, string> = {
  move: '»',
  fireball: '✹',
  shield: '◈',
  teleport: '✧',
  trap: '✕',
  wait: '…',
};

export const ARROW: Record<Dir, string> = { up: '↑', down: '↓', left: '←', right: '→' };

export function ActionIcon({ type }: { type: ActionType }) {
  return (
    <Img
      className="icon"
      src={`/assets/icon-${type}.png`}
      alt={ACTION_LABEL[type]}
      fallback={<span className={`icon-glyph g-${type}`}>{GLYPH[type]}</span>}
    />
  );
}

/** Petit texte de direction d'une action (flèches ; rien si secret). */
export function actionHint(a: RevealedAction): string {
  if (a.type === 'teleport') {
    const h = a.dx > 0 ? '→' : '←';
    const v = a.dy > 0 ? '↓' : '↑';
    return h.repeat(Math.abs(a.dx)) + v.repeat(Math.abs(a.dy));
  }
  if ('dir' in a) return a.dir ? ARROW[a.dir] : '?';
  return '';
}

/** Carte d'action (slot, révélation). */
export function ActionChip({ action }: { action: RevealedAction }) {
  const hint = actionHint(action);
  return (
    <span className="chip" title={ACTION_LABEL[action.type]}>
      <ActionIcon type={action.type} />
      {hint && <span className="chip-hint">{hint}</span>}
    </span>
  );
}
