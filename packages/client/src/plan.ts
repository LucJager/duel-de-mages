import { DIRS, LAVA_ROUNDS, TELEPORT_RANGE, addPos, inBounds, maxFireballs, onCooldown, samePos, slotsFor, validatePlan } from '@dm/shared';
import type { Action, ActionType, Dir, GameState, PlayerId, PlayerState, Pos } from '@dm/shared';

export interface PreviewStep {
  action: Action;
  from: Pos;
  to: Pos;
  /** Cases traversées par la boule de feu (jusqu'au bord). */
  fireball?: Pos[];
  /** Case où le piège est posé. */
  trap?: Pos;
  /** Case où le bloc de glace est posé. */
  ice?: Pos;
  /** Case visée par le météore. */
  meteor?: Pos;
  /** Bourrasque lancée depuis `from`. */
  gust?: boolean;
  /** Le mouvement est annulé (mur, glace ou étourdissement). */
  blocked?: boolean;
}

/**
 * Prévisualisation du plan en supposant que les mouvements réussissent (pas de BONK).
 * `ice` = blocs de glace déjà présents ; ceux posés par le plan s'y ajoutent.
 */
export function previewPlan(start: Pos, size: number, actions: Action[], stunned = false, ice: Pos[] = []): PreviewStep[] {
  let pos = start;
  let stun = stunned;
  const blocks = [...ice];
  const iceAt = (c: Pos) => blocks.some((b) => samePos(b, c));
  return actions.map((action) => {
    const from = pos;
    const step: PreviewStep = { action, from, to: from };
    if (action.type === 'move' || action.type === 'teleport') {
      const target = action.type === 'move' ? addPos(from, DIRS[action.dir]) : addPos(from, { x: action.dx, y: action.dy });
      if (stun || !inBounds(target, size) || iceAt(target)) {
        step.blocked = true;
        stun = false;
      } else {
        step.to = target;
      }
    } else if (action.type === 'fireball') {
      step.fireball = [];
      for (let c = addPos(from, DIRS[action.dir]); inBounds(c, size); c = addPos(c, DIRS[action.dir])) {
        step.fireball.push(c);
        if (iceAt(c)) break;
      }
    } else if (action.type === 'trap' || action.type === 'ice') {
      const at = addPos(from, DIRS[action.dir]);
      if (action.type === 'trap' && inBounds(at, size)) step.trap = at;
      if (action.type === 'ice' && inBounds(at, size) && !iceAt(at)) {
        step.ice = at;
        blocks.push(at);
      }
    } else if (action.type === 'meteor') {
      step.meteor = { x: action.x, y: action.y };
    } else if (action.type === 'gust') {
      step.gust = true;
    }
    pos = step.to;
    return step;
  });
}

/** Position prévue à la fin du plan. */
export function plannedPos(start: Pos, size: number, actions: Action[], stunned = false, ice: Pos[] = []): Pos {
  const steps = previewPlan(start, size, actions, stunned, ice);
  return steps.length ? steps[steps.length - 1].to : start;
}

/** Cases atteignables en téléport depuis `from` (distance 1 à TELEPORT_RANGE, dans l'arène). */
export function teleportTargets(from: Pos, size: number): Pos[] {
  const out: Pos[] = [];
  for (let dy = -TELEPORT_RANGE; dy <= TELEPORT_RANGE; dy++) {
    for (let dx = -TELEPORT_RANGE; dx <= TELEPORT_RANGE; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      const p = { x: from.x + dx, y: from.y + dy };
      if (d >= 1 && d <= TELEPORT_RANGE && inBounds(p, size)) out.push(p);
    }
  }
  return out;
}

/** Direction d'une case adjacente, ou null. */
export function dirTo(from: Pos, to: Pos): Dir | null {
  for (const [dir, d] of Object.entries(DIRS) as [Dir, Pos][]) {
    if (from.x + d.x === to.x && from.y + d.y === to.y) return dir;
  }
  return null;
}

/** Action type « exemple » pour tester si on peut encore l'ajouter au plan. */
const SAMPLE: Record<ActionType, Action> = {
  move: { type: 'move', dir: 'up' },
  fireball: { type: 'fireball', dir: 'up' },
  shield: { type: 'shield' },
  teleport: { type: 'teleport', dx: 1, dy: 0 },
  trap: { type: 'trap', dir: 'up' },
  meteor: { type: 'meteor', x: 0, y: 0 },
  gust: { type: 'gust' },
  ice: { type: 'ice', dir: 'up' },
  wait: { type: 'wait' },
};

/** Raison pour laquelle ce type d'action ne peut pas être ajouté, ou null. */
export function cannotAdd(state: GameState, me: PlayerId, plan: Action[], type: ActionType): string | null {
  return validatePlan(state, me, [...plan, SAMPLE[type]]);
}

/** Manches de recharge restantes à afficher sur le bouton (0 = disponible). */
export function cooldownLeft(state: GameState, player: PlayerState, type: ActionType): number {
  return onCooldown(state, player, type) ? player.ready[type]! - state.round : 0;
}

/** Bandeau du bonus de la manche (mode Chaos), ou null. */
export function bonusText(state: GameState): string | null {
  switch (state.bonus) {
    case 'fireRain':
      return `Pluie de feu — ${maxFireballs(state)} boules de feu cette manche`;
    case 'recharge':
      return 'Recharge — aucun sort en recharge cette manche';
    case 'heal':
      return 'Soin — chaque mage a récupéré 1 PV';
    case 'haste':
      return `Hâte — ${slotsFor(state)} actions cette manche`;
    default:
      return null;
  }
}

/** Prochaine manche où la lave monte (>= round), ou null. */
export function nextLavaRound(round: number): number | null {
  return LAVA_ROUNDS.find((r) => r >= round) ?? null;
}
