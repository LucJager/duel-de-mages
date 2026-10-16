import {
  BONUSES,
  COOLDOWNS,
  DIRS,
  LAVA_ROUNDS,
  MAX_FIREBALLS_PER_ROUND,
  MAX_HP,
  SLOTS,
  TELEPORT_RANGE,
  boardSize,
} from './constants';
import type {
  Action,
  ActionType,
  Bonus,
  Dir,
  GameEvent,
  GameState,
  Ice,
  Mode,
  PlayerId,
  PlayerState,
  Pos,
  RoundResult,
} from './types';

export const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
export const addPos = (a: Pos, b: Pos): Pos => ({ x: a.x + b.x, y: a.y + b.y });
export const inBounds = (p: Pos, size: number) => p.x >= 0 && p.y >= 0 && p.x < size && p.y < size;

/** Distance de la case au bord le plus proche (0 = anneau extérieur). */
export function ringOf(p: Pos, size: number): number {
  return Math.min(p.x, p.y, size - 1 - p.x, size - 1 - p.y);
}

/** Nombre d'anneaux en lave pendant la manche donnée. */
export function lavaRings(round: number): number {
  return LAVA_ROUNDS.filter((r) => round >= r).length;
}

export function isLava(p: Pos, size: number, round: number): boolean {
  return ringOf(p, size) < lavaRings(round);
}

/** Nombre d'actions à planifier cette manche. */
export function slotsFor(state: GameState): number {
  return state.bonus === 'haste' ? SLOTS + 1 : SLOTS;
}

export function maxFireballs(state: GameState): number {
  return state.bonus === 'fireRain' ? MAX_FIREBALLS_PER_ROUND + 1 : MAX_FIREBALLS_PER_ROUND;
}

/** Le sort est-il en recharge pour ce joueur cette manche ? */
export function onCooldown(state: GameState, player: PlayerState, type: ActionType): boolean {
  return state.bonus !== 'recharge' && state.round < (player.ready[type] ?? 0);
}

export function rollBonus(rng: () => number = Math.random): Bonus {
  return BONUSES[Math.floor(rng() * BONUSES.length)];
}

/** Début de manche : applique le bonus tiré (le soin est immédiat). */
export function startRound(state: GameState, bonus: Bonus | null): GameState {
  const s = clone(state);
  s.bonus = bonus;
  if (bonus === 'heal') for (const p of s.players) if (p.alive) p.hp = Math.min(MAX_HP, p.hp + 1);
  return s;
}

export function createGame(players: { id: PlayerId; name: string }[], mode: Mode = 'classic'): GameState {
  const size = boardSize(players.length);
  const m = size - 1;
  const spawns: Pos[] = [
    { x: 0, y: 0 },
    { x: m, y: m },
    { x: m, y: 0 },
  ];
  return {
    size,
    mode,
    bonus: null,
    round: 1,
    players: players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: i,
      pos: spawns[i],
      hp: MAX_HP,
      alive: true,
      stunned: false,
      ready: {},
    })),
    traps: [],
    ice: [],
    over: false,
    winner: null,
  };
}

const SPELL_NAMES: Partial<Record<ActionType, string>> = {
  teleport: 'téléport',
  shield: 'bouclier',
  meteor: 'météore',
  gust: 'bourrasque',
  ice: 'mur de glace',
};

/** Retourne un message d'erreur, ou null si le plan est valide. */
export function validatePlan(state: GameState, playerId: PlayerId, actions: Action[]): string | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 'Joueur inconnu';
  if (!player.alive) return 'Joueur mort';
  const slots = slotsFor(state);
  if (!Array.isArray(actions) || actions.length > slots) return `Maximum ${slots} actions`;
  let fireballs = 0;
  const used = new Map<ActionType, number>();
  for (const a of actions) {
    if (!a || typeof a !== 'object') return 'Action invalide';
    switch (a.type) {
      case 'move':
      case 'fireball':
      case 'trap':
      case 'ice':
        if (!Object.hasOwn(DIRS, a.dir)) return 'Direction invalide';
        if (a.type === 'fireball') fireballs++;
        break;
      case 'teleport': {
        if (!Number.isInteger(a.dx) || !Number.isInteger(a.dy)) return 'Téléport invalide';
        const d = Math.abs(a.dx) + Math.abs(a.dy);
        if (d < 1 || d > TELEPORT_RANGE) return `Téléport : distance 1 à ${TELEPORT_RANGE}`;
        break;
      }
      case 'meteor':
        if (!Number.isInteger(a.x) || !Number.isInteger(a.y) || !inBounds(a, state.size)) return 'Météore hors de l\'arène';
        break;
      case 'shield':
      case 'gust':
      case 'wait':
        break;
      default:
        return 'Action inconnue';
    }
    used.set(a.type, (used.get(a.type) ?? 0) + 1);
  }
  if (fireballs > maxFireballs(state)) return `Maximum ${maxFireballs(state)} boules de feu`;
  for (const [type, n] of used) {
    const name = SPELL_NAMES[type];
    if (!name) continue;
    if (n > 1) return `Un seul ${name} par manche`;
    if (onCooldown(state, player, type)) return `${name[0].toUpperCase()}${name.slice(1)} en recharge`;
  }
  return null;
}

/** Complète le plan avec des « Attendre » jusqu'à `slots` actions. */
export function padPlan(actions: Action[] | undefined, slots = SLOTS): Action[] {
  const plan = (actions ?? []).slice(0, slots);
  while (plan.length < slots) plan.push({ type: 'wait' });
  return plan;
}

function clone(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, pos: { ...p.pos }, ready: { ...p.ready } })),
    traps: state.traps.map((t) => ({ ...t, pos: { ...t.pos } })),
    ice: state.ice.map((i) => ({ ...i, pos: { ...i.pos } })),
  };
}

/**
 * Résout une manche complète. Fonction pure : ne modifie pas `state`.
 * Les plans absents ou invalides sont remplacés par « Attendre ».
 */
export function resolveRound(state: GameState, plansIn: Record<PlayerId, Action[] | undefined>): RoundResult {
  const s = clone(state);
  const slots = slotsFor(state);
  const plans: Record<PlayerId, Action[]> = {};
  for (const p of s.players) {
    if (!p.alive) continue;
    const raw = plansIn[p.id];
    plans[p.id] = padPlan(raw && validatePlan(state, p.id, raw) === null ? raw : [], slots);
    if (s.bonus === 'recharge') continue;
    for (const a of plans[p.id]) {
      const cd = COOLDOWNS[a.type];
      if (cd) p.ready[a.type] = s.round + cd;
    }
  }

  const steps: GameEvent[][] = [];
  for (let i = 0; i < slots && !s.over; i++) {
    const acts = new Map<PlayerId, Action>();
    for (const p of s.players) if (p.alive) acts.set(p.id, plans[p.id][i]);
    steps.push(resolveStep(s, acts));
  }

  if (!s.over) endRound(s, steps[steps.length - 1]);
  if (!s.over) {
    s.round++;
    s.bonus = null;
  }
  return { round: state.round, start: clone(state), plans, steps, state: s };
}

/**
 * Annule les déplacements en conflit (glace, même case visée, case occupée par un mage
 * qui reste, échange) jusqu'à stabilité. Modifie `dest`, retourne les BONK.
 */
function settleMoves(alive: PlayerState[], dest: Map<PlayerId, Pos>, ice: Ice[]): GameEvent[] {
  const bonks: GameEvent[] = [];
  const revert = (ids: PlayerId[], at: Pos) => {
    for (const id of ids) dest.delete(id);
    bonks.push({ type: 'bonk', players: ids, at });
  };
  for (const [id, d] of dest) if (ice.some((i) => samePos(i.pos, d))) revert([id], d);
  for (let changed = true; changed; ) {
    changed = false;
    // Plusieurs mages visent la même case
    const groups = new Map<string, PlayerId[]>();
    for (const [id, d] of dest) {
      const k = `${d.x},${d.y}`;
      groups.set(k, [...(groups.get(k) ?? []), id]);
    }
    for (const ids of groups.values()) {
      if (ids.length > 1) {
        revert(ids, dest.get(ids[0])!);
        changed = true;
      }
    }
    if (changed) continue;
    for (const [id, d] of dest) {
      const me = alive.find((p) => p.id === id)!;
      for (const other of alive) {
        if (other.id === id || !samePos(other.pos, d)) continue;
        const od = dest.get(other.id);
        if (!od) {
          // La case visée est occupée par un mage qui reste sur place
          revert([id], d);
          changed = true;
        } else if (samePos(od, me.pos)) {
          // Échange de cases
          revert([id, other.id], d);
          changed = true;
        }
        break;
      }
      if (changed) break;
    }
  }
  return bonks;
}

function resolveStep(s: GameState, acts: Map<PlayerId, Action>): GameEvent[] {
  const ev: GameEvent[] = [];
  const alive = s.players.filter((p) => p.alive);
  const byId = new Map(alive.map((p) => [p.id, p]));
  const damage = new Map<PlayerId, number>();
  const hurt = (id: PlayerId) => damage.set(id, (damage.get(id) ?? 0) + 1);
  const iceAt = (c: Pos) => s.ice.some((i) => samePos(i.pos, c));

  // 1. Boucliers
  const shielded = new Set<PlayerId>();
  for (const p of alive) {
    if (acts.get(p.id)?.type === 'shield') {
      shielded.add(p.id);
      ev.push({ type: 'shield', player: p.id });
    }
  }

  // 2. Mouvements et téléports
  const dest = new Map<PlayerId, Pos>();
  const teleporting = new Set<PlayerId>();
  for (const p of alive) {
    const a = acts.get(p.id)!;
    if (a.type !== 'move' && a.type !== 'teleport') continue;
    if (p.stunned) {
      p.stunned = false;
      ev.push({ type: 'stunned', player: p.id });
      continue;
    }
    const target = a.type === 'move' ? addPos(p.pos, DIRS[a.dir]) : addPos(p.pos, { x: a.dx, y: a.dy });
    if (!inBounds(target, s.size)) {
      ev.push({ type: 'wall', player: p.id, at: p.pos });
      continue;
    }
    if (a.type === 'teleport') teleporting.add(p.id);
    dest.set(p.id, target);
  }
  ev.push(...settleMoves(alive, dest, s.ice));
  for (const [id, d] of dest) {
    const p = byId.get(id)!;
    ev.push({ type: 'move', player: id, from: p.pos, to: d, kind: teleporting.has(id) ? 'teleport' : 'walk' });
    p.pos = d;
  }

  // 3. Bourrasques : poussée d'une case à l'opposé du lanceur
  const pushDir = new Map<PlayerId, Dir>();
  const pushCount = new Map<PlayerId, number>();
  for (const p of alive) {
    if (acts.get(p.id)!.type !== 'gust') continue;
    ev.push({ type: 'gust', player: p.id });
    for (const dir of Object.keys(DIRS) as Dir[]) {
      const cell = addPos(p.pos, DIRS[dir]);
      const target = alive.find((o) => samePos(o.pos, cell));
      if (!target) continue;
      pushDir.set(target.id, dir);
      pushCount.set(target.id, (pushCount.get(target.id) ?? 0) + 1);
    }
  }
  const pushed = new Map<PlayerId, Pos>();
  for (const [id, n] of pushCount) {
    const p = byId.get(id)!;
    const target = addPos(p.pos, DIRS[pushDir.get(id)!]);
    // Poussé des deux côtés ou contre le bord : reste sur place
    if (n > 1 || !inBounds(target, s.size)) ev.push({ type: 'bonk', players: [id], at: p.pos });
    else pushed.set(id, target);
  }
  ev.push(...settleMoves(alive, pushed, s.ice));
  for (const [id, d] of pushed) {
    const p = byId.get(id)!;
    ev.push({ type: 'move', player: id, from: p.pos, to: d, kind: 'push' });
    p.pos = d;
  }

  // 4. Pièges : déclenchement à l'arrivée, puis pose des nouveaux pièges et de la glace
  for (const id of new Set([...dest.keys(), ...pushed.keys()])) {
    const p = byId.get(id)!;
    const sprung = s.traps.filter((t) => t.owner !== id && samePos(t.pos, p.pos));
    for (const t of sprung) {
      ev.push({ type: 'trapTriggered', player: id, owner: t.owner, at: t.pos });
      hurt(id);
      p.stunned = true;
    }
    s.traps = s.traps.filter((t) => !sprung.includes(t));
  }
  for (const p of alive) {
    const a = acts.get(p.id)!;
    if (a.type !== 'trap' && a.type !== 'ice') continue;
    const at = addPos(p.pos, DIRS[a.dir]);
    if (!inBounds(at, s.size)) continue;
    if (a.type === 'trap') {
      s.traps = s.traps.filter((t) => t.owner !== p.id);
      s.traps.push({ owner: p.id, pos: at });
      ev.push({ type: 'trapPlaced', player: p.id, at });
    } else if (!iceAt(at) && !alive.some((o) => samePos(o.pos, at))) {
      // Dure jusqu'à la fin de la manche suivante
      s.ice.push({ pos: at, owner: p.id, expires: s.round + 1 });
      ev.push({ type: 'icePlaced', player: p.id, at });
    }
  }

  // 5. Boules de feu (depuis la position après mouvement, arrêtées par la glace) et météores
  for (const p of alive) {
    const a = acts.get(p.id)!;
    if (a.type === 'fireball') {
      const path: Pos[] = [];
      let hit: PlayerId | null = null;
      for (let c = addPos(p.pos, DIRS[a.dir]); inBounds(c, s.size); c = addPos(c, DIRS[a.dir])) {
        path.push(c);
        if (iceAt(c)) break;
        const target = alive.find((o) => samePos(o.pos, c));
        if (target) {
          hit = target.id;
          hurt(target.id);
          break;
        }
      }
      ev.push({ type: 'fireball', player: p.id, dir: a.dir, path, hit });
    } else if (a.type === 'meteor') {
      const at = { x: a.x, y: a.y };
      const target = alive.find((o) => samePos(o.pos, at));
      if (target) hurt(target.id);
      ev.push({ type: 'meteor', player: p.id, at, hit: target?.id ?? null });
    }
  }

  // 6. Dégâts, morts
  applyDamage(s, damage, shielded, ev);
  return ev;
}

function applyDamage(s: GameState, damage: Map<PlayerId, number>, shielded: Set<PlayerId>, ev: GameEvent[]) {
  const alive = s.players.filter((p) => p.alive);
  for (const [id, n] of damage) {
    const p = alive.find((o) => o.id === id)!;
    if (shielded.has(id)) {
      ev.push({ type: 'shieldBlock', player: id });
      continue;
    }
    p.hp = Math.max(0, p.hp - n);
    ev.push({ type: 'damage', player: id, amount: n, hp: p.hp });
  }
  for (const p of alive) {
    if (p.hp <= 0) {
      p.alive = false;
      ev.push({ type: 'death', player: p.id });
    }
  }
  s.traps = s.traps.filter((t) => s.players.find((p) => p.id === t.owner)?.alive);

  const survivors = s.players.filter((p) => p.alive);
  if (survivors.length <= 1) {
    s.over = true;
    s.winner = survivors[0]?.id ?? null;
  }
}

/** Fin de manche : -1 PV sur la lave (le bouclier ne protège pas), puis fonte de la glace. */
function endRound(s: GameState, ev: GameEvent[]) {
  const damage = new Map<PlayerId, number>();
  for (const p of s.players) {
    if (p.alive && isLava(p.pos, s.size, s.round)) {
      ev.push({ type: 'lava', player: p.id, at: p.pos });
      damage.set(p.id, 1);
    }
  }
  if (damage.size) applyDamage(s, damage, new Set(), ev);
  for (const i of s.ice) if (i.expires <= s.round) ev.push({ type: 'iceMelted', at: i.pos });
  s.ice = s.ice.filter((i) => i.expires > s.round);
}

/** Vue d'un état pour un joueur : seuls ses propres pièges sont visibles. */
export function viewFor(state: GameState, playerId: PlayerId | null): GameState {
  return { ...state, traps: state.traps.filter((t) => t.owner === playerId) };
}

/** Retire les événements secrets (pose de piège des autres) pour un joueur. */
export function resultFor(result: RoundResult, playerId: PlayerId | null): RoundResult {
  return {
    ...result,
    start: viewFor(result.start, playerId),
    steps: result.steps.map((step) => step.filter((e) => e.type !== 'trapPlaced' || e.player === playerId)),
    plans: Object.fromEntries(
      Object.entries(result.plans).map(([id, plan]) => [
        id,
        // On révèle qu'un piège a été posé, mais pas sa direction
        id === playerId ? plan : plan.map((a) => (a.type === 'trap' ? { type: 'trap' as const, dir: null } : a)),
      ]),
    ),
    state: viewFor(result.state, playerId),
  };
}
