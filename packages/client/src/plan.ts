import { DIRS, LAVA_ROUNDS, TELEPORT_RANGE, addPos, inBounds, validatePlan } from '@dm/shared';
import type { Action, ActionType, Dir, GameState, PlayerId, Pos } from '@dm/shared';

export interface PreviewStep {
  action: Action;
  from: Pos;
  to: Pos;
  /** Cases traversées par la boule de feu (jusqu'au bord). */
  fireball?: Pos[];
  /** Case où le piège est posé. */
  trap?: Pos;
  /** Le mouvement est annulé (mur ou étourdissement). */
  blocked?: boolean;
}

/** Prévisualisation du plan en supposant que les mouvements réussissent (pas de BONK). */
export function previewPlan(start: Pos, size: number, actions: Action[], stunned = false): PreviewStep[] {
  let pos = start;
  let stun = stunned;
  return actions.map((action) => {
    const from = pos;
    const step: PreviewStep = { action, from, to: from };
    if (action.type === 'move' || action.type === 'teleport') {
      const target = action.type === 'move' ? addPos(from, DIRS[action.dir]) : addPos(from, { x: action.dx, y: action.dy });
      if (stun || !inBounds(target, size)) {
        step.blocked = true;
        stun = false;
      } else {
        step.to = target;
      }
    } else if (action.type === 'fireball') {
      step.fireball = [];
      for (let c = addPos(from, DIRS[action.dir]); inBounds(c, size); c = addPos(c, DIRS[action.dir])) step.fireball.push(c);
    } else if (action.type === 'trap') {
      const at = addPos(from, DIRS[action.dir]);
      if (inBounds(at, size)) step.trap = at;
    }
    pos = step.to;
    return step;
  });
}

/** Position prévue à la fin du plan. */
export function plannedPos(start: Pos, size: number, actions: Action[], stunned = false): Pos {
  const steps = previewPlan(start, size, actions, stunned);
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
  wait: { type: 'wait' },
};

/** Raison pour laquelle ce type d'action ne peut pas être ajouté, ou null. */
export function cannotAdd(state: GameState, me: PlayerId, plan: Action[], type: ActionType): string | null {
  return validatePlan(state, me, [...plan, SAMPLE[type]]);
}

/** Prochaine manche où la lave monte (>= round), ou null. */
export function nextLavaRound(round: number): number | null {
  return LAVA_ROUNDS.find((r) => r >= round) ?? null;
}
