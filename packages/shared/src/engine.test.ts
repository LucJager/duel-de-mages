import { describe, expect, it } from 'vitest';
import { createGame, isLava, resolveRound, resultFor, validatePlan, viewFor } from './engine';
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
    expect(of(r.steps, 'move')[0].teleport).toBe(true);
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

  it('1 dégât par step passé sur la lave, le bouclier protège', () => {
    const r = resolveRound(game([{ x: 0, y: 0 }, { x: 2, y: 2 }], { round: 6 }), { p0: [SH] });
    expect(of(r.steps, 'lava')).toHaveLength(3);
    expect(r.state.players[0].hp).toBe(1);
    expect(r.state.players[1].hp).toBe(3);
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
