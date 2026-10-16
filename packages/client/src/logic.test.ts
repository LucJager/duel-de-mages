import { describe, expect, it } from 'vitest';
import { createGame, resolveRound } from '@dm/shared';
import type { RoundResult } from '@dm/shared';
import { bonusText, cannotAdd, cooldownLeft, dirTo, nextLavaRound, plannedPos, previewPlan, teleportTargets } from './plan';
import { applyStep, displayFrom, summarize } from './reveal';

const duel = () => createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);

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

  it('prévisualise météore, bourrasque et glace', () => {
    const steps = previewPlan({ x: 1, y: 1 }, 5, [
      { type: 'meteor', x: 4, y: 3 },
      { type: 'gust' },
      { type: 'ice', dir: 'right' },
    ]);
    expect(steps[0].meteor).toEqual({ x: 4, y: 3 });
    expect(steps[1]).toMatchObject({ gust: true, from: { x: 1, y: 1 } });
    expect(steps[2].ice).toEqual({ x: 2, y: 1 });
    // Pas de glace hors de l'arène
    expect(previewPlan({ x: 0, y: 0 }, 5, [{ type: 'ice', dir: 'up' }])[0].ice).toBeUndefined();
  });

  it('la glace bloque les mouvements et arrête les boules de feu', () => {
    const ice = [{ x: 3, y: 0 }];
    const steps = previewPlan({ x: 0, y: 0 }, 5, [
      { type: 'fireball', dir: 'right' },
      { type: 'ice', dir: 'down' },
      { type: 'move', dir: 'down' },
    ], false, ice);
    expect(steps[0].fireball).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
    // Bloc posé par le plan : le mouvement suivant est bloqué
    expect(steps[2].blocked).toBe(true);
    expect(previewPlan({ x: 2, y: 0 }, 5, [{ type: 'move', dir: 'right' }], false, ice)[0].blocked).toBe(true);
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
    const g = duel();
    const fb = { type: 'fireball', dir: 'up' } as const;
    expect(cannotAdd(g, 'a', [fb], 'fireball')).toBeNull();
    expect(cannotAdd(g, 'a', [fb, fb], 'fireball')).not.toBeNull();
    expect(cannotAdd(g, 'a', [fb, fb, { type: 'wait' }], 'wait')).not.toBeNull();
  });

  it('applique les bonus Pluie de feu et Hâte', () => {
    const g = { ...duel(), bonus: 'fireRain' as const };
    const fb = { type: 'fireball', dir: 'up' } as const;
    expect(cannotAdd(g, 'a', [fb, fb], 'fireball')).toBeNull();
    const w = { type: 'wait' } as const;
    expect(cannotAdd({ ...duel(), bonus: 'haste' }, 'a', [w, w, w], 'wait')).toBeNull();
    expect(bonusText(g)).toContain('3 boules de feu');
    expect(bonusText({ ...duel(), bonus: 'haste' })).toContain('4 actions');
    expect(bonusText(duel())).toBeNull();
  });

  it('refuse un sort en double ou en recharge, et compte la recharge', () => {
    const g = duel();
    expect(cannotAdd(g, 'a', [{ type: 'gust' }], 'gust')).not.toBeNull();
    expect(cannotAdd(g, 'a', [{ type: 'gust' }], 'meteor')).toBeNull();
    g.players[0].ready = { meteor: 2, ice: 3 };
    expect(cannotAdd(g, 'a', [], 'meteor')).not.toBeNull();
    expect(cooldownLeft(g, g.players[0], 'meteor')).toBe(1);
    expect(cooldownLeft(g, g.players[0], 'ice')).toBe(2);
    expect(cooldownLeft(g, g.players[0], 'gust')).toBe(0);
    // Bonus Recharge : plus aucune recharge
    const r = { ...g, bonus: 'recharge' as const };
    expect(cannotAdd(r, 'a', [], 'meteor')).toBeNull();
    expect(cooldownLeft(r, g.players[0], 'meteor')).toBe(0);
  });

  it('annonce la prochaine lave', () => {
    expect(nextLavaRound(1)).toBe(6);
    expect(nextLavaRound(6)).toBe(6);
    expect(nextLavaRound(13)).toBeNull();
  });
});

describe('applyStep', () => {
  it('applique déplacements, dégâts, morts et pièges', () => {
    const g = duel();
    g.traps = [{ owner: 'b', pos: { x: 3, y: 3 } }];
    const d0 = displayFrom(g);
    const d1 = applyStep(d0, [
      { type: 'move', player: 'a', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, kind: 'walk' },
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

  it('pose et fait fondre la glace', () => {
    const g = duel();
    g.ice = [{ pos: { x: 2, y: 2 }, owner: 'b', expires: 1 }];
    const d0 = displayFrom(g);
    expect(d0.ice).toEqual([{ x: 2, y: 2 }]);
    const d1 = applyStep(d0, [
      { type: 'icePlaced', player: 'a', at: { x: 1, y: 0 } },
      { type: 'iceMelted', at: { x: 2, y: 2 } },
    ]);
    expect(d1.ice).toEqual([{ x: 1, y: 0 }]);
    expect(d0.ice).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('résume touches, poussées, météores, lave et morts', () => {
    const g = duel();
    g.players[0].pos = { x: 2, y: 2 };
    g.players[1].pos = { x: 3, y: 2 };
    g.players[1].hp = 1;
    const r = resolveRound(g, {
      a: [{ type: 'gust' }, { type: 'wait' }, { type: 'wait' }],
      b: [{ type: 'wait' }, { type: 'meteor', x: 2, y: 2 }, { type: 'wait' }],
    });
    const lines = summarize(r);
    expect(lines[0]).toBe('Action 1 : B est repoussé par la bourrasque');
    expect(lines[1]).toBe('Action 2 : météore de B sur A');
    expect(lines).toHaveLength(2);

    // Lave en fin de manche : préfixe dédié, mort comprise
    const lava = duel();
    lava.round = 6;
    lava.players[1].hp = 1;
    const end = summarize(resolveRound(lava, {}));
    expect(end).toEqual(['Fin de manche : A brûle dans la lave', 'Fin de manche : B brûle dans la lave', 'Fin de manche : B est K.O. !']);
  });

  it('ne dit rien d\'une manche calme', () => {
    const r: RoundResult = resolveRound(duel(), {});
    expect(summarize(r)).toEqual([]);
  });
});
