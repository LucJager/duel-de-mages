import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { padPlan } from '@dm/shared';
import type { Action, PlayerId, RoomView, RoundResult } from '@dm/shared';
import { RoomManager } from './rooms';

/** Plan complété par des « Attendre » (3 actions). */
const plan = (...actions: Action[]) => padPlan(actions);
const W = plan();

function setup(rng?: () => number) {
  const views = new Map<PlayerId, RoomView>();
  const results = new Map<PlayerId, RoundResult[]>();
  const rooms = new RoomManager(
    {
      state: (id, v) => views.set(id, v),
      result: (id, r) => results.set(id, [...(results.get(id) ?? []), r]),
    },
    { planningMs: 1000, revealMs: 100, idleMs: 5000, rng },
  );
  return { rooms, views, results };
}

/** Salle de 3 joueurs (a = hôte). */
function threePlayers(mode?: string, rng?: () => number) {
  const s = setup(rng);
  const { code, you: a } = s.rooms.create('Alice', 'tok-a', mode);
  const { you: b } = s.rooms.join(code, 'Bob', 'tok-b');
  const { you: c } = s.rooms.join(code.toLowerCase(), ' Carol ', 'tok-c');
  return { ...s, code, a, b, c };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('salles', () => {
  it('crée une salle avec un code de 4 lettres sans I ni O', () => {
    const { rooms, views } = setup();
    const { code, you } = rooms.create('Alice', 'tok');
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(views.get(you)).toMatchObject({ code, hostId: you, phase: 'lobby', mode: 'classic', history: [] });
  });

  it('valide les entrées', () => {
    const { rooms } = setup();
    expect(() => rooms.create('', 'tok')).toThrow('Pseudo');
    expect(() => rooms.create('x'.repeat(17), 'tok')).toThrow('Pseudo');
    expect(() => rooms.create('Alice', undefined)).toThrow('Token');
    expect(() => rooms.create('Alice', 'tok', 'turbo')).toThrow('Mode');
    expect(() => rooms.join('AB', 'Bob', 'tok')).toThrow('Code');
    expect(() => rooms.join('ZZZZ', 'Bob', 'tok')).toThrow('introuvable');
  });

  it('rejoint une salle et voit tout le monde', () => {
    const { views, a, c } = threePlayers();
    expect(views.get(a)!.players.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(views.get(c)!.you).toBe(c);
  });

  it('refuse une salle pleine', () => {
    const { rooms, code } = threePlayers();
    expect(() => rooms.join(code, 'Dan', 'tok-d')).toThrow('pleine');
  });

  it('refuse un nouveau joueur en pleine partie, mais reconnecte un token connu', () => {
    const { rooms, views } = setup();
    const { code, you: a } = rooms.create('Alice', 'tok-a');
    const { you: b } = rooms.join(code, 'Bob', 'tok-b');
    rooms.start(code, a);
    expect(() => rooms.join(code, 'Dan', 'tok-d')).toThrow('en cours');
    rooms.leave(code, b);
    expect(views.get(a)!.players.find((p) => p.id === b)!.connected).toBe(false);
    expect(rooms.join(code, 'Bob', 'tok-b').you).toBe(b);
    expect(views.get(b)!.players.find((p) => p.id === b)!.connected).toBe(true);
    expect(views.get(b)!.game).not.toBeNull();
  });

  it('retire le joueur en lobby et transmet l’hôte', () => {
    const { rooms, views, code, a, b } = threePlayers();
    rooms.leave(code, a);
    expect(views.get(b)!.hostId).toBe(b);
    expect(views.get(b)!.players).toHaveLength(2);
  });

  it('en lobby, une déconnexion garde la place et la salle', () => {
    const { rooms, views } = setup();
    const { code, you: a } = rooms.create('Alice', 'tok-a');
    rooms.leave(code, a, false);
    expect(rooms.has(code)).toBe(true);
    expect(rooms.join(code, 'Alice', 'tok-a').you).toBe(a);
    const { you: b } = rooms.join(code, 'Bob', 'tok-b');
    rooms.leave(code, b, false);
    expect(() => rooms.start(code, a)).toThrow('au moins');
    expect(views.get(a)!.hostId).toBe(a);
  });

  it('un joueur qui revient reprend l’hôte si celui-ci est absent', () => {
    const { rooms, views } = setup();
    const { code, you: a } = rooms.create('Alice', 'tok-a');
    const { you: b } = rooms.join(code, 'Bob', 'tok-b');
    rooms.start(code, a);
    rooms.leave(code, b, false);
    rooms.leave(code, a, false);
    rooms.join(code, 'Bob', 'tok-b');
    expect(views.get(b)!.hostId).toBe(b);
  });

  it('start réservé à l’hôte, avec assez de joueurs', () => {
    const s = setup();
    const { code, you: a } = s.rooms.create('Alice', 'tok-a');
    expect(() => s.rooms.start(code, a)).toThrow('au moins');
    const { you: b } = s.rooms.join(code, 'Bob', 'tok-b');
    expect(() => s.rooms.start(code, b)).toThrow('hôte');
    s.rooms.start(code, a);
    expect(s.views.get(b)).toMatchObject({ phase: 'planning', deadline: Date.now() + 1000 });
  });
});

describe('manches', () => {
  it('résout dès que tout le monde a soumis', () => {
    const { rooms, views, results, code, a, b, c } = threePlayers();
    rooms.start(code, a);
    rooms.submit(code, a, W);
    rooms.submit(code, b, plan({ type: 'shield' }));
    expect(views.get(a)!.phase).toBe('planning');
    rooms.submit(code, c, W);
    expect(views.get(a)!.phase).toBe('revealing');
    expect(results.get(c)).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(views.get(a)).toMatchObject({ phase: 'planning', game: { round: 2 } });
  });

  it('résout au timeout et ignore les déconnectés pour la résolution anticipée', () => {
    const { rooms, views, code, a, b, c } = threePlayers();
    rooms.start(code, a);
    rooms.leave(code, c);
    rooms.submit(code, a, W);
    expect(views.get(a)!.phase).toBe('planning');
    vi.advanceTimersByTime(1000);
    expect(views.get(a)!.phase).toBe('revealing');
    vi.advanceTimersByTime(100);
    rooms.submit(code, a, W);
    rooms.submit(code, b, W);
    expect(views.get(a)!.phase).toBe('revealing');
  });

  it('refuse les plans invalides ou hors planification', () => {
    const { rooms, code, a, b, c } = threePlayers();
    expect(() => rooms.submit(code, a, [])).toThrow('Aucune partie');
    rooms.start(code, a);
    expect(() => rooms.submit(code, a, 'n’importe quoi')).toThrow('invalide');
    expect(() => rooms.submit(code, a, [{ type: 'move', dir: 'toString' }])).toThrow('Direction');
    expect(() => rooms.submit(code, a, [{ type: 'fireball', dir: 'up' }, { type: 'fireball', dir: 'up' }, { type: 'fireball', dir: 'up' }])).toThrow('boules');
    expect(() => rooms.submit(code, a, [null])).toThrow('Action');
    expect(() => rooms.submit(code, a, plan({ type: 'meteor', x: 9, y: 0 }))).toThrow('Météore');
    expect(() => rooms.submit(code, a, [{ type: 'gust' }, { type: 'gust' }, { type: 'wait' }])).toThrow('Un seul');
    rooms.submit(code, a, W);
    rooms.submit(code, b, W);
    rooms.submit(code, c, W);
    expect(() => rooms.submit(code, a, W)).toThrow('planification');
  });

  it('refuse un plan incomplet ou trop long', () => {
    const { rooms, code, a } = threePlayers();
    rooms.start(code, a);
    expect(() => rooms.submit(code, a, [])).toThrow('Choisis 3 actions');
    expect(() => rooms.submit(code, a, [{ type: 'wait' }])).toThrow('Choisis 3 actions');
    expect(() => rooms.submit(code, a, [...W, { type: 'wait' }])).toThrow('Choisis 3 actions');
  });

  it('reconstruit les nouveaux sorts sans champs parasites', () => {
    const { rooms, views, code, a } = threePlayers();
    rooms.start(code, a);
    rooms.submit(code, a, [
      { type: 'meteor', x: 2, y: 3, evil: 1 },
      { type: 'gust', dir: 'up' },
      { type: 'ice', dir: 'down', dx: 5 },
    ]);
    expect(views.get(a)!.myPlan).toEqual([{ type: 'meteor', x: 2, y: 3 }, { type: 'gust' }, { type: 'ice', dir: 'down' }]);
  });

  it('annule un plan validé tant que la planification dure', () => {
    const { rooms, views, code, a, b, c } = threePlayers();
    rooms.start(code, a);
    rooms.submit(code, a, plan({ type: 'shield' }));
    expect(views.get(b)!.players.find((p) => p.id === a)!.ready).toBe(true);
    rooms.cancel(code, a);
    expect(views.get(b)!.players.find((p) => p.id === a)!.ready).toBe(false);
    expect(views.get(a)!.myPlan).toBeNull();
    // Sans le plan d'Alice, la manche n'est pas résolue
    rooms.submit(code, b, W);
    rooms.submit(code, c, W);
    expect(views.get(a)!.phase).toBe('planning');
    rooms.submit(code, a, W);
    expect(views.get(a)!.phase).toBe('revealing');
    expect(() => rooms.cancel(code, a)).toThrow('planification');
  });

  it('ne fuite jamais le plan ni les pièges des autres', () => {
    const { rooms, views, results, code, a, b, c } = threePlayers();
    rooms.start(code, a);
    // Alice (0,0) pose un piège à droite, Bob en pose un en haut
    rooms.submit(code, a, plan({ type: 'trap', dir: 'right' }));
    rooms.submit(code, a, plan({ type: 'trap', dir: 'down' })); // remplace le précédent
    rooms.submit(code, b, plan({ type: 'trap', dir: 'up' }));
    const bobView = views.get(b)!;
    expect(bobView.players.find((p) => p.id === a)!.ready).toBe(true);
    expect(bobView.myPlan).toEqual(plan({ type: 'trap', dir: 'up' }));
    expect(JSON.stringify(bobView)).not.toContain('down');
    expect(views.get(a)!.myPlan).toEqual(plan({ type: 'trap', dir: 'down' }));
    rooms.submit(code, c, W);

    const resB = results.get(b)![0];
    expect(resB.plans[a]).toEqual([{ type: 'trap', dir: null }, { type: 'wait' }, { type: 'wait' }]);
    expect(resB.steps.flat().filter((e) => e.type === 'trapPlaced').every((e) => e.player === b)).toBe(true);
    for (const id of [a, b, c]) {
      const v = views.get(id)!;
      expect(v.game!.traps.every((t) => t.owner === id)).toBe(true);
      expect(v.lastResult!.state.traps.every((t) => t.owner === id)).toBe(true);
    }
    expect(views.get(a)!.game!.traps).toEqual([{ owner: a, pos: { x: 0, y: 1 } }]);
    expect(views.get(c)!.game!.traps).toEqual([]);
  });

  it('historique de la partie, filtré pour chacun', () => {
    const { rooms, views, code, a, b, c } = threePlayers();
    rooms.start(code, a);
    rooms.submit(code, a, plan({ type: 'trap', dir: 'down' }));
    rooms.submit(code, b, plan({ type: 'trap', dir: 'up' }));
    rooms.submit(code, c, W);
    vi.advanceTimersByTime(100);
    for (const id of [a, b, c]) rooms.submit(code, id, W);
    for (const id of [a, b, c]) {
      const { history } = views.get(id)!;
      expect(history.map((r) => r.round)).toEqual([1, 2]);
      expect(history[1].start.round).toBe(2);
      for (const r of history) {
        expect([...r.start.traps, ...r.state.traps].every((t) => t.owner === id)).toBe(true);
        expect(r.steps.flat().every((e) => e.type !== 'trapPlaced' || e.player === id)).toBe(true);
      }
      for (const other of [a, b].filter((o) => o !== id)) {
        expect(history[0].plans[other][0]).toEqual({ type: 'trap', dir: null });
      }
    }
    expect(views.get(a)!.history[1].start.traps).toEqual([{ owner: a, pos: { x: 0, y: 1 } }]);
    expect(views.get(c)!.history[1].start.traps).toEqual([]);
  });

  it('mode classique : jamais de bonus', () => {
    const { rooms, views, code, a, b, c } = threePlayers('classic', () => 0.6);
    rooms.start(code, a);
    expect(views.get(a)).toMatchObject({ mode: 'classic', game: { mode: 'classic', bonus: null } });
    for (const id of [a, b, c]) rooms.submit(code, id, W);
    vi.advanceTimersByTime(100);
    expect(views.get(a)!.game).toMatchObject({ round: 2, bonus: null });
  });

  it('mode Chaos : un bonus tiré à chaque manche, le soin est appliqué', () => {
    // haste (4 actions), puis heal
    const rolls = [0.9, 0.6];
    const { rooms, views, code, a, b, c } = threePlayers('chaos', () => rolls.shift() ?? 0);
    rooms.start(code, a);
    expect(views.get(a)).toMatchObject({ mode: 'chaos', game: { mode: 'chaos', bonus: 'haste' } });
    expect(() => rooms.submit(code, a, W)).toThrow('Choisis 4 actions');
    // Alice (0,0) tire à droite sur Carol (5,0)
    rooms.submit(code, a, [{ type: 'fireball', dir: 'right' }, ...W]);
    rooms.submit(code, b, [...W, { type: 'wait' }]);
    rooms.submit(code, c, [...W, { type: 'wait' }]);
    expect(views.get(c)!.game!.players.find((p) => p.id === c)!.hp).toBe(2);
    vi.advanceTimersByTime(100);
    const game = views.get(c)!.game!;
    expect(game).toMatchObject({ round: 2, bonus: 'heal' });
    expect(game.players.find((p) => p.id === c)!.hp).toBe(3);
  });

  it('rematch : nouvelle partie avec les présents', () => {
    const { rooms, views, code, a, b, c } = threePlayers();
    rooms.start(code, a);
    rooms.leave(code, c);
    // Attente passive jusqu'à la fin (la lave finit la partie)
    for (let i = 0; i < 40 && views.get(a)!.phase !== 'over'; i++) vi.advanceTimersByTime(1100);
    expect(views.get(a)!.phase).toBe('over');
    expect(() => rooms.rematch(code, b)).toThrow('hôte');
    expect(views.get(a)!.history.length).toBeGreaterThan(0);
    rooms.rematch(code, a);
    expect(views.get(b)).toMatchObject({ phase: 'planning', game: { round: 1 }, history: [] });
    expect(views.get(b)!.players.map((p) => p.id)).toEqual([a, b]);
  });

  it('purge les salles inactives', () => {
    const { rooms, code } = threePlayers();
    rooms.purge(Date.now() + 6000);
    expect(rooms.has(code)).toBe(false);
  });
});
