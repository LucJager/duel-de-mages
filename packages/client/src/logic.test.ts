import { describe, expect, it } from 'vitest';
import { createGame } from '@dm/shared';
import { cannotAdd, dirTo, nextLavaRound, plannedPos, previewPlan, teleportTargets } from './plan';
import { applyStep, displayFrom } from './reveal';

describe('previewPlan', () => {
  it('suit les mouvements et le téléport', () => {
    const steps = previewPlan({ x: 0, y: 0 }, 5, [
      { type: 'move', dir: 'right' },
      { type: 'teleport', dx: 1, dy: 1 },
      { type: 'move', dir: 'down' },
    ]);
    expect(steps.map((s) => s.to)).toEqual([{ x: 1, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }]);
  });

  it('bloque contre le mur', () => {
    const [s] = previewPlan({ x: 0, y: 0 }, 5, [{ type: 'move', dir: 'left' }]);
    expect(s.blocked).toBe(true);
    expect(s.to).toEqual({ x: 0, y: 0 });
  });

  it('annule le premier mouvement si étourdi', () => {
    const steps = previewPlan(
      { x: 0, y: 0 },
      5,
      [{ type: 'move', dir: 'right' }, { type: 'move', dir: 'right' }],
      true,
    );
    expect(steps[0].blocked).toBe(true);
    expect(steps[1].to).toEqual({ x: 1, y: 0 });
  });

  it('trace la boule de feu et le piège depuis la position prévue', () => {
    const steps = previewPlan({ x: 0, y: 0 }, 5, [
      { type: 'move', dir: 'down' },
      { type: 'fireball', dir: 'right' },
      { type: 'trap', dir: 'up' },
    ]);
    expect(steps[1].fireball).toHaveLength(4);
    expect(steps[1].fireball![0]).toEqual({ x: 1, y: 1 });
    expect(steps[2].trap).toEqual({ x: 0, y: 0 });
    expect(plannedPos({ x: 0, y: 0 }, 5, [{ type: 'trap', dir: 'left' }])).toEqual({ x: 0, y: 0 });
  });
});

describe('aides de planification', () => {
  it('liste les cibles de téléport dans l\'arène', () => {
    expect(teleportTargets({ x: 0, y: 0 }, 5)).toHaveLength(5);
    expect(teleportTargets({ x: 2, y: 2 }, 5)).toHaveLength(12);
  });

  it('trouve la direction d\'une case adjacente', () => {
    expect(dirTo({ x: 1, y: 1 }, { x: 1, y: 0 })).toBe('up');
    expect(dirTo({ x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });

  it('refuse une 3e boule de feu et un plan plein', () => {
    const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    const fb = { type: 'fireball', dir: 'up' } as const;
    expect(cannotAdd(g, 'a', [fb], 'fireball')).toBeNull();
    expect(cannotAdd(g, 'a', [fb, fb], 'fireball')).not.toBeNull();
    expect(cannotAdd(g, 'a', [fb, fb, { type: 'wait' }], 'wait')).not.toBeNull();
  });

  it('annonce la prochaine lave', () => {
    expect(nextLavaRound(1)).toBe(6);
    expect(nextLavaRound(6)).toBe(6);
    expect(nextLavaRound(13)).toBeNull();
  });
});

describe('applyStep', () => {
  it('applique déplacements, dégâts, morts et pièges', () => {
    const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    g.traps = [{ owner: 'b', pos: { x: 3, y: 3 } }];
    const d0 = displayFrom(g);
    const d1 = applyStep(d0, [
      { type: 'move', player: 'a', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, teleport: false },
      { type: 'trapPlaced', player: 'a', at: { x: 2, y: 0 } },
      { type: 'damage', player: 'b', amount: 3, hp: 0 },
      { type: 'death', player: 'b' },
    ]);
    expect(d1.mages.a.pos).toEqual({ x: 1, y: 0 });
    expect(d1.mages.b).toMatchObject({ hp: 0, alive: false });
    expect(d1.traps).toEqual([{ owner: 'a', pos: { x: 2, y: 0 } }]);
    // L'état de départ n'est pas modifié
    expect(d0.mages.a.pos).toEqual({ x: 0, y: 0 });
    expect(d0.mages.b.alive).toBe(true);
  });
});
