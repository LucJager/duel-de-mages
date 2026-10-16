import { describe, expect, it } from 'vitest';
import { createGame, isLava, resolveRound, resultFor, rollBonus, slotsFor, startRound, validatePlan, viewFor } from './engine';
import type { Action, GameEvent, GameState, Pos } from './types';

const W: Action = { type: 'wait' };
const mv = (dir: 'up' | 'down' | 'left' | 'right'): Action => ({ type: 'move', dir });
const fb = (dir: 'up' | 'down' | 'left' | 'right'): Action => ({ type: 'fireball', dir });
const SH: Action = { type: 'shield' };

function game(positions: Pos[], patch: Partial<GameState> = {}): GameState {
  const g = createGame(positions.map((_, i) => ({ id: `p${i}`, name: `P${i}` })));
  g.players.forEach((p, i) => (p.pos = positions[i]));
  return { ...g, ...patch };
}
const all = (steps: GameEvent[][]) => steps.flat();
const of = <T extends GameEvent['type']>(steps: GameEvent[][], type: T) =>
  all(steps).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

describe('createGame', () => {
  it('5×5 à 2 joueurs, 6×6 à 3 joueurs, spawns dans les coins', () => {
    const g2 = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    expect(g2.size).toBe(5);
    expect(g2.players.map((p) => p.pos)).toEqual([{ x: 0, y: 0 }, { x: 4, y: 4 }]);
    const g3 = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
    expect(g3.size).toBe(6);
    expect(g3.players[2].pos).toEqual({ x: 5, y: 0 });
    expect(g3.players.every((p) => p.hp === 3)).toBe(true);
  });
});

describe('mouvements', () => {
  it('déplace d\'une case', () => {
    const r = resolveRound(game([{ x: 1, y: 1 }, { x: 4, y: 4 }]), { p0: [mv('right'), mv('down'), W] });
    expect(r.state.players[0].pos).toEqual({ x: 2, y: 2 });
    expect(r.state.round).toBe(2);
  });

  it('BONK : deux mages visent la même case et restent sur place', () => {
    const r = resolveRound(game([{ x: 1, y: 2 }, { x: 3, y: 2 }]), { p0: [mv('right')], p1: [mv('left')] });
    expect(r.state.players[0].pos).toEqual({ x: 1, y: 2 });
    expect(r.state.players[1].pos).toEqual({ x: 3, y: 2 });
    expect(of(r.steps, 'bonk')[0]).toMatchObject({ players: ['p0', 'p1'], at: { x: 2, y: 2 } });
  });

  it('BONK : échange de cases', () => {
    const r = resolveRound(game([{ x: 1, y: 2 }, { x: 2, y: 2 }]), { p0: [mv('right')], p1: [mv('left')] });
    expect(r.state.players[0].pos).toEqual({ x: 1, y: 2 });
    expect(r.state.players[1].pos).toEqual({ x: 2, y: 2 });
    expect(of(r.steps, 'bonk')).toHaveLength(1);
  });

  it('BONK contre un mage immobile', () => {
    const r = resolveRound(game([{ x: 1, y: 2 }, { x: 2, y: 2 }]), { p0: [mv('right')] });
    expect(r.state.players[0].pos).toEqual({ x: 1, y: 2 });
    expect(of(r.steps, 'bonk')[0].players).toEqual(['p0']);
  });

  it('suivre un mage qui se déplace est autorisé', () => {
    const r = resolveRound(game([{ x: 1, y: 2 }, { x: 2, y: 2 }]), { p0: [mv('right')], p1: [mv('right')] });
    expect(r.state.players[0].pos).toEqual({ x: 2, y: 2 });
    expect(r.state.players[1].pos).toEqual({ x: 3, y: 2 });
  });

  it('un bonk en chaîne bloque aussi le suiveur', () => {
    // p1 et p2 visent la même case → bonk ; p0 suivait p1 → bloqué aussi
    const r = resolveRound(game([{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 3, y: 2 }]), {
      p0: [mv('right')],
      p1: [mv('right')],
      p2: [mv('left')],
    });
    expect(r.state.players.map((p) => p.pos)).toEqual([{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 3, y: 2 }]);
  });

  it('mur : reste sur place', () => {
    const r = resolveRound(game([{ x: 0, y: 0 }, { x: 4, y: 4 }]), { p0: [mv('up')] });
    expect(r.state.players[0].pos).toEqual({ x: 0, y: 0 });
    expect(of(r.steps, 'wall')).toHaveLength(1);
  });

  it('téléport à distance 2 puis cooldown', () => {
    const g = game([{ x: 0, y: 0 }, { x: 4, y: 4 }]);
    const r = resolveRound(g, { p0: [{ type: 'teleport', dx: 1, dy: 1 }] });
    expect(r.state.players[0].pos).toEqual({ x: 1, y: 1 });
    expect(of(r.steps, 'move')[0].kind).toBe('teleport');
    expect(validatePlan(r.state, 'p0', [{ type: 'teleport', dx: 1, dy: 0 }])).toMatch(/recharge/);
    const r2 = resolveRound(r.state, {});
    expect(validatePlan(r2.state, 'p0', [{ type: 'teleport', dx: 1, dy: 0 }])).toBeNull();
  });
});

describe('boules de feu et boucliers', () => {
  it('touche le premier mage sur la ligne, depuis la position après mouvement', () => {
    const r = resolveRound(game([{ x: 0, y: 1 }, { x: 4, y: 2 }]), { p0: [mv('down'), fb('right')] });
    const f = of(r.steps, 'fireball')[0];
    expect(f.hit).toBe('p1');
    expect(f.path.at(-1)).toEqual({ x: 4, y: 2 });
    expect(r.state.players[1].hp).toBe(2);
  });

  it('s\'arrête au premier mage (protège ceux derrière)', () => {
    const r = resolveRound(game([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }]), { p0: [fb('right')] });
    expect(of(r.steps, 'fireball')[0].hit).toBe('p1');
    expect(r.state.players[2].hp).toBe(3);
  });

  it('rate si la cible a bougé', () => {
    const r = resolveRound(game([{ x: 0, y: 2 }, { x: 4, y: 2 }]), { p0: [fb('right')], p1: [mv('up')] });
    expect(of(r.steps, 'fireball')[0].hit).toBeNull();
    expect(r.state.players[1].hp).toBe(3);
  });

  it('le bouclier bloque la boule de feu', () => {
    const r = resolveRound(game([{ x: 0, y: 2 }, { x: 4, y: 2 }]), { p0: [fb('right')], p1: [SH] });
    expect(of(r.steps, 'shieldBlock')).toHaveLength(1);
    expect(r.state.players[1].hp).toBe(3);
  });

  it('le bouclier ne dure qu\'un step', () => {
    const r = resolveRound(game([{ x: 0, y: 2 }, { x: 4, y: 2 }]), { p0: [W, fb('right')], p1: [SH] });
    expect(r.state.players[1].hp).toBe(2);
  });

  it('limites par manche', () => {
    const g = game([{ x: 0, y: 0 }, { x: 4, y: 4 }]);
    expect(validatePlan(g, 'p0', [fb('up'), fb('up'), fb('up')])).toMatch(/boules/);
    expect(validatePlan(g, 'p0', [SH, SH])).toMatch(/bouclier/);
    expect(validatePlan(g, 'p0', [{ type: 'teleport', dx: 2, dy: 1 }])).toMatch(/distance/);
    expect(validatePlan(g, 'p0', [W, W, W, W])).toMatch(/Maximum/);
    expect(validatePlan(g, 'p0', [fb('up'), fb('down'), SH])).toBeNull();
    expect(validatePlan(g, 'p0', [{ type: 'move', dir: 'toString' as 'up' }])).toMatch(/Direction/);
  });

  it('un plan invalide devient « Attendre »', () => {
    const r = resolveRound(game([{ x: 0, y: 2 }, { x: 4, y: 2 }]), { p0: [fb('right'), fb('right'), fb('right')] });
    expect(r.plans.p0.every((a) => a.type === 'wait')).toBe(true);
    expect(r.state.players[1].hp).toBe(3);
  });
});

describe('pièges', () => {
  it('se déclenche à l\'arrivée : 1 dégât et annule le prochain mouvement', () => {
    const g = game([{ x: 0, y: 2 }, { x: 3, y: 2 }]);
    const r = resolveRound(g, { p0: [{ type: 'trap', dir: 'right' }], p1: [W, mv('left'), mv('left')] });
    // p1 arrive en (2,2) ? Non : le piège est en (1,2). p1 va en (2,2) puis (1,2) au step 3.
    expect(r.state.players[1].pos).toEqual({ x: 1, y: 2 });
    expect(r.state.players[1].hp).toBe(2);
    expect(r.state.players[1].stunned).toBe(true);
    expect(r.state.traps).toHaveLength(0);
    const r2 = resolveRound(r.state, { p1: [mv('down'), mv('down')] });
    expect(of(r2.steps, 'stunned')).toHaveLength(1);
    expect(r2.state.players[1].pos).toEqual({ x: 1, y: 3 });
  });

  it('le propriétaire est immunisé à son propre piège', () => {
    const r = resolveRound(game([{ x: 0, y: 2 }, { x: 4, y: 4 }]), { p0: [{ type: 'trap', dir: 'right' }, mv('right')] });
    expect(r.state.players[0].hp).toBe(3);
    expect(r.state.traps).toHaveLength(1);
  });

  it('un seul piège actif par joueur', () => {
    const r = resolveRound(game([{ x: 2, y: 2 }, { x: 4, y: 4 }]), {
      p0: [{ type: 'trap', dir: 'right' }, { type: 'trap', dir: 'left' }],
    });
    expect(r.state.traps).toEqual([{ owner: 'p0', pos: { x: 1, y: 2 } }]);
  });

  it('les pièges des autres sont invisibles', () => {
    const r = resolveRound(game([{ x: 2, y: 2 }, { x: 4, y: 4 }]), { p0: [{ type: 'trap', dir: 'right' }] });
    expect(viewFor(r.state, 'p1').traps).toHaveLength(0);
    expect(viewFor(r.state, 'p0').traps).toHaveLength(1);
    const forP1 = resultFor(r, 'p1');
    expect(of(forP1.steps, 'trapPlaced')).toHaveLength(0);
    expect(forP1.plans.p0[0]).toEqual({ type: 'trap', dir: null });
    expect(of(resultFor(r, 'p0').steps, 'trapPlaced')).toHaveLength(1);
  });
});

describe('lave et fin de partie', () => {
  it('l\'anneau extérieur devient de la lave à la manche 6, le suivant à la 9', () => {
    expect(isLava({ x: 0, y: 2 }, 5, 5)).toBe(false);
    expect(isLava({ x: 0, y: 2 }, 5, 6)).toBe(true);
    expect(isLava({ x: 1, y: 2 }, 5, 6)).toBe(false);
    expect(isLava({ x: 1, y: 2 }, 5, 9)).toBe(true);
    expect(isLava({ x: 2, y: 2 }, 5, 9)).toBe(false);
  });

  it('traverser la lave ne fait rien, finir dessus coûte 1 PV même avec bouclier', () => {
    const g = game([{ x: 1, y: 1 }, { x: 2, y: 2 }], { round: 6 });
    const r = resolveRound(g, { p0: [mv('left'), mv('right'), W] });
    expect(of(r.steps, 'lava')).toHaveLength(0);
    expect(r.state.players[0].hp).toBe(3);
    const r2 = resolveRound(g, { p0: [W, W, mv('left')], p1: [SH] });
    expect(of(r2.steps, 'lava')).toHaveLength(1);
    expect(r2.steps[2].map((e) => e.type)).toContain('lava');
    expect(r2.state.players[0].hp).toBe(2);
    const r3 = resolveRound(game([{ x: 0, y: 0 }, { x: 2, y: 2 }], { round: 6 }), { p0: [W, W, SH] });
    expect(r3.state.players[0].hp).toBe(2);
    expect(of(r3.steps, 'shieldBlock')).toHaveLength(0);
  });

  it('la lave peut tuer et finir la partie', () => {
    const g = game([{ x: 0, y: 0 }, { x: 2, y: 2 }], { round: 6 });
    g.players[0].hp = 1;
    const r = resolveRound(g, {});
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe('p1');
    expect(r.state.round).toBe(6);
  });

  it('victoire du dernier survivant, la partie s\'arrête au step de la mort', () => {
    const g = game([{ x: 0, y: 2 }, { x: 4, y: 2 }]);
    g.players[1].hp = 1;
    const r = resolveRound(g, { p0: [fb('right'), mv('up'), mv('up')] });
    expect(r.steps).toHaveLength(1);
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBe('p0');
    expect(r.state.round).toBe(1);
  });

  it('égalité si tout le monde meurt au même step', () => {
    const g = game([{ x: 0, y: 2 }, { x: 4, y: 2 }]);
    g.players.forEach((p) => (p.hp = 1));
    const r = resolveRound(g, { p0: [fb('right')], p1: [fb('left')] });
    expect(of(r.steps, 'death')).toHaveLength(2);
    expect(r.state.over).toBe(true);
    expect(r.state.winner).toBeNull();
  });

  it('à 3 joueurs : un mort, la partie continue', () => {
    const g = game([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]);
    g.players[1].hp = 1;
    const r = resolveRound(g, { p0: [fb('right')], p2: [mv('left')] });
    expect(r.state.players[1].alive).toBe(false);
    expect(r.state.over).toBe(false);
    expect(Object.keys(r.plans)).toEqual(['p0', 'p1', 'p2']);
    const r2 = resolveRound(r.state, { p0: [fb('down')] });
    expect(Object.keys(r2.plans)).toEqual(['p0', 'p2']);
  });

  it('les cumuls de dégâts dans un même step s\'additionnent', () => {
    const g = game([{ x: 0, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 0 }]);
    const r = resolveRound(g, { p0: [fb('right')], p2: [fb('down')] });
    expect(of(r.steps, 'damage')[0]).toMatchObject({ player: 'p1', amount: 2, hp: 1 });
  });

  it('ne modifie pas l\'état d\'entrée', () => {
    const g = game([{ x: 0, y: 2 }, { x: 4, y: 2 }]);
    const snapshot = JSON.stringify(g);
    resolveRound(g, { p0: [mv('right'), fb('right')], p1: [{ type: 'trap', dir: 'left' }] });
    expect(JSON.stringify(g)).toBe(snapshot);
  });
});

describe('recharges', () => {
  it('bouclier : 1 manche sur 2', () => {
    const g = game([{ x: 0, y: 0 }, { x: 4, y: 4 }]);
    const r = resolveRound(g, { p0: [SH] });
    expect(r.state.players[0].ready.shield).toBe(3);
    expect(validatePlan(r.state, 'p0', [SH])).toMatch(/Bouclier en recharge/);
    const r2 = resolveRound(r.state, {});
    expect(validatePlan(r2.state, 'p0', [SH])).toBeNull();
  });

  it('un sort à recharge au plus 1 fois par manche', () => {
    const g = game([{ x: 0, y: 0 }, { x: 4, y: 4 }]);
    expect(validatePlan(g, 'p0', [{ type: 'gust' }, { type: 'gust' }])).toMatch(/Un seul/);
    expect(validatePlan(g, 'p0', [{ type: 'ice', dir: 'up' }, { type: 'ice', dir: 'down' }])).toMatch(/Un seul/);
  });
});

describe('météore', () => {
  const met = (x: number, y: number): Action => ({ type: 'meteor', x, y });

  it('touche le mage sur la case visée, après mouvement', () => {
    const r = resolveRound(game([{ x: 0, y: 0 }, { x: 3, y: 3 }]), { p0: [met(3, 2)], p1: [mv('up')] });
    expect(of(r.steps, 'meteor')[0]).toMatchObject({ player: 'p0', at: { x: 3, y: 2 }, hit: 'p1' });
    expect(r.state.players[1].hp).toBe(2);
    expect(r.state.players[0].ready.meteor).toBe(3);
  });

  it('rate une case vide, et touche aussi le lanceur', () => {
    const r = resolveRound(game([{ x: 0, y: 0 }, { x: 3, y: 3 }]), { p0: [met(2, 2)] });
    expect(of(r.steps, 'meteor')[0].hit).toBeNull();
    const r2 = resolveRound(game([{ x: 0, y: 0 }, { x: 3, y: 3 }]), { p0: [met(0, 0)] });
    expect(r2.state.players[0].hp).toBe(2);
  });

  it('doit viser dans l\'arène', () => {
    const g = game([{ x: 0, y: 0 }, { x: 4, y: 4 }]);
    expect(validatePlan(g, 'p0', [met(5, 0)])).toMatch(/hors/);
  });
});

describe('bourrasque', () => {
  const GU: Action = { type: 'gust' };

  it('repousse les mages adjacents d\'une case', () => {
    const r = resolveRound(game([{ x: 2, y: 2 }, { x: 3, y: 2 }]), { p0: [GU] });
    expect(r.state.players[1].pos).toEqual({ x: 4, y: 2 });
    expect(of(r.steps, 'move')[0]).toMatchObject({ player: 'p1', kind: 'push' });
    expect(of(r.steps, 'gust')).toHaveLength(1);
  });

  it('pousse après les mouvements', () => {
    const r = resolveRound(game([{ x: 2, y: 2 }, { x: 4, y: 2 }]), { p0: [GU], p1: [mv('left')] });
    expect(r.state.players[1].pos).toEqual({ x: 4, y: 2 });
  });

  it('BONK contre le bord ou un mage', () => {
    const r = resolveRound(game([{ x: 3, y: 2 }, { x: 4, y: 2 }]), { p0: [GU] });
    expect(r.state.players[1].pos).toEqual({ x: 4, y: 2 });
    expect(of(r.steps, 'bonk')[0].players).toEqual(['p1']);
    const r2 = resolveRound(game([{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }]), { p0: [GU] });
    expect(r2.state.players[1].pos).toEqual({ x: 2, y: 2 });
    expect(of(r2.steps, 'bonk')).toHaveLength(1);
  });

  it('poussé par deux bourrasques : reste sur place', () => {
    const r = resolveRound(game([{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }]), { p0: [GU], p2: [GU] });
    expect(r.state.players[1].pos).toEqual({ x: 2, y: 2 });
    // Les deux lanceurs, adjacents seulement à p1, ne bougent pas
    expect(r.state.players[0].pos).toEqual({ x: 1, y: 2 });
    expect(r.state.players[2].pos).toEqual({ x: 3, y: 2 });
  });

  it('pousse dans un piège', () => {
    const g = game([{ x: 2, y: 2 }, { x: 3, y: 3 }]);
    g.traps = [{ owner: 'p0', pos: { x: 4, y: 3 } }];
    const r = resolveRound(g, { p0: [mv('down'), GU] });
    expect(r.state.players[1].pos).toEqual({ x: 4, y: 3 });
    expect(of(r.steps, 'trapTriggered')).toHaveLength(1);
    expect(r.state.players[1].hp).toBe(2);
  });

  it('pousse sur la lave en fin de manche', () => {
    const r = resolveRound(game([{ x: 2, y: 2 }, { x: 3, y: 2 }], { round: 6 }), { p0: [W, W, GU] });
    expect(r.state.players[1].pos).toEqual({ x: 4, y: 2 });
    expect(r.state.players[1].hp).toBe(2);
  });
});

describe('mur de glace', () => {
  const ice = (dir: 'up' | 'down' | 'left' | 'right'): Action => ({ type: 'ice', dir });

  it('bloque les mouvements (BONK) et les boules de feu', () => {
    const r = resolveRound(game([{ x: 1, y: 2 }, { x: 4, y: 2 }]), { p0: [ice('right'), fb('right')], p1: [W, W, mv('left')] });
    expect(r.state.ice).toEqual([{ pos: { x: 2, y: 2 }, owner: 'p0', expires: 2 }]);
    expect(of(r.steps, 'fireball')[0]).toMatchObject({ hit: null, path: [{ x: 2, y: 2 }] });
    expect(r.state.players[1].hp).toBe(3);
    // p1 est en (3,2), la glace en (2,2) dure encore la manche 2
    const r2 = resolveRound(r.state, { p1: [mv('left')] });
    expect(r2.state.players[1].pos).toEqual({ x: 3, y: 2 });
    expect(of(r2.steps, 'bonk')).toHaveLength(1);
  });

  it('ne se pose pas sur un mage, ignoré par le météore', () => {
    const r = resolveRound(game([{ x: 1, y: 2 }, { x: 2, y: 2 }]), { p0: [ice('right')] });
    expect(r.state.ice).toHaveLength(0);
    expect(of(r.steps, 'icePlaced')).toHaveLength(0);
  });

  it('fond à la fin de la manche suivante', () => {
    const r = resolveRound(game([{ x: 1, y: 2 }, { x: 4, y: 4 }]), { p0: [ice('right')] });
    expect(r.state.ice).toHaveLength(1);
    const r2 = resolveRound(r.state, {});
    expect(r2.state.ice).toHaveLength(0);
    expect(of(r2.steps, 'iceMelted')).toEqual([{ type: 'iceMelted', at: { x: 2, y: 2 } }]);
  });
});

describe('mode Chaos', () => {
  const chaos = (bonus: Parameters<typeof startRound>[1]) =>
    startRound(game([{ x: 0, y: 2 }, { x: 4, y: 2 }], { mode: 'chaos' }), bonus);

  it('pluie de feu : 3 boules de feu', () => {
    const g = chaos('fireRain');
    expect(validatePlan(g, 'p0', [fb('right'), fb('right'), fb('right')])).toBeNull();
    expect(resolveRound(g, { p0: [fb('right'), fb('right'), fb('right')] }).state.over).toBe(true);
  });

  it('recharge : pas de recharge cette manche', () => {
    const g = game([{ x: 0, y: 2 }, { x: 4, y: 2 }]);
    g.players[0].ready.shield = 5;
    const c = startRound(g, 'recharge');
    expect(validatePlan(c, 'p0', [SH])).toBeNull();
    const r = resolveRound(c, { p0: [SH, { type: 'gust' }] });
    expect(r.state.players[0].ready.gust).toBeUndefined();
    expect(r.state.bonus).toBeNull();
  });

  it('soin : +1 PV au début de la manche, max 3', () => {
    const g = game([{ x: 0, y: 2 }, { x: 4, y: 2 }]);
    g.players[0].hp = 1;
    const c = startRound(g, 'heal');
    expect(c.players.map((p) => p.hp)).toEqual([2, 3]);
    expect(g.players[0].hp).toBe(1);
  });

  it('hâte : 4 actions', () => {
    const g = chaos('haste');
    expect(slotsFor(g)).toBe(4);
    const r = resolveRound(g, { p0: [mv('right'), mv('right'), mv('right'), mv('up')] });
    expect(r.steps).toHaveLength(4);
    expect(r.state.players[0].pos).toEqual({ x: 3, y: 1 });
    expect(validatePlan(g, 'p0', [W, W, W, W, W])).toMatch(/Maximum 4/);
  });

  it('rollBonus tire un des 4 bonus', () => {
    expect(rollBonus(() => 0)).toBe('fireRain');
    expect(rollBonus(() => 0.99)).toBe('haste');
  });
});

describe('historique', () => {
  it('start = état avant la manche, pièges adverses masqués', () => {
    const g = game([{ x: 2, y: 2 }, { x: 4, y: 4 }]);
    g.traps = [{ owner: 'p0', pos: { x: 1, y: 1 } }];
    const r = resolveRound(g, { p0: [mv('right')] });
    expect(r.start.players[0].pos).toEqual({ x: 2, y: 2 });
    expect(resultFor(r, 'p1').start.traps).toHaveLength(0);
    expect(resultFor(r, 'p0').start.traps).toHaveLength(1);
  });
});
