import { randomBytes } from 'node:crypto';
import {
  DIRS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLANNING_MS,
  REVEAL_MS,
  ROOM_IDLE_MS,
  createGame,
  resolveRound,
  resultFor,
  validatePlan,
  viewFor,
} from '@dm/shared';
import type { Action, GameState, PlayerId, RoomPhase, RoomView, RoundResult } from '@dm/shared';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

interface Member {
  id: PlayerId;
  token: string;
  name: string;
  connected: boolean;
}

interface Room {
  code: string;
  hostId: PlayerId;
  phase: RoomPhase;
  members: Member[];
  game: GameState | null;
  plans: Map<PlayerId, Action[]>;
  deadline: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  lastResult: RoundResult | null;
  lastActivity: number;
}

/** Erreur destinée au client (renvoyée dans l'ack). */
export class RoomError extends Error {}

export interface RoomEvents {
  state: (playerId: PlayerId, view: RoomView) => void;
  result: (playerId: PlayerId, result: RoundResult) => void;
}

export interface RoomOptions {
  planningMs?: number;
  revealMs?: number;
  idleMs?: number;
}

export function cleanName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : '';
  if (n.length < 1 || n.length > 16) throw new RoomError('Pseudo : 1 à 16 caractères');
  return n;
}

export function cleanCode(code: unknown): string {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!/^[A-Z]{4}$/.test(c)) throw new RoomError('Code de salle invalide');
  return c;
}

function cleanToken(token: unknown): string {
  if (typeof token !== 'string' || token.length < 1 || token.length > 128) throw new RoomError('Token invalide');
  return token;
}

const isDir = (d: unknown) => typeof d === 'string' && Object.hasOwn(DIRS, d);

/** Reconstruit un plan propre (sans champs parasites) à partir d'un payload client. */
function cleanPlan(actions: unknown): Action[] {
  if (!Array.isArray(actions)) throw new RoomError('Plan invalide');
  return actions.map((a): Action => {
    if (!a || typeof a !== 'object') throw new RoomError('Action invalide');
    switch (a.type) {
      case 'move':
      case 'fireball':
      case 'trap':
        if (!isDir(a.dir)) throw new RoomError('Direction invalide');
        return { type: a.type, dir: a.dir };
      case 'teleport':
        return { type: 'teleport', dx: a.dx, dy: a.dy };
      case 'shield':
      case 'wait':
        return { type: a.type };
      default:
        throw new RoomError('Action inconnue');
    }
  });
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private planningMs: number;
  private revealMs: number;
  private idleMs: number;

  constructor(
    private events: RoomEvents,
    opts: RoomOptions = {},
  ) {
    this.planningMs = opts.planningMs ?? PLANNING_MS;
    this.revealMs = opts.revealMs ?? REVEAL_MS;
    this.idleMs = opts.idleMs ?? ROOM_IDLE_MS;
  }

  create(name: unknown, token: unknown): { code: string; you: PlayerId } {
    const member: Member = { id: newId(), token: cleanToken(token), name: cleanName(name), connected: true };
    let code: string;
    do {
      code = Array.from(randomBytes(4), (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      hostId: member.id,
      phase: 'lobby',
      members: [member],
      game: null,
      plans: new Map(),
      deadline: null,
      timer: null,
      lastResult: null,
      lastActivity: Date.now(),
    };
    this.rooms.set(code, room);
    this.broadcast(room);
    return { code, you: member.id };
  }

  join(codeIn: unknown, name: unknown, token: unknown): { you: PlayerId } {
    const code = cleanCode(codeIn);
    const tok = cleanToken(token);
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('Salle introuvable');
    const known = room.members.find((m) => m.token === tok);
    if (known) {
      // Reconnexion : il reprend sa place, et l'hôte s'il était absent
      known.connected = true;
      if (room.phase === 'lobby') known.name = cleanName(name);
      if (!room.members.find((m) => m.id === room.hostId)?.connected) room.hostId = known.id;
    } else {
      const n = cleanName(name);
      if (room.phase !== 'lobby') throw new RoomError('Partie déjà en cours');
      if (room.members.length >= MAX_PLAYERS) {
        // Un absent du lobby cède sa place
        const ghost = room.members.find((m) => !m.connected);
        if (!ghost) throw new RoomError('Salle pleine');
        room.members = room.members.filter((m) => m !== ghost);
      }
      room.members.push({ id: newId(), token: tok, name: n, connected: true });
    }
    this.touch(room);
    this.broadcast(room);
    return { you: (known ?? room.members.at(-1)!).id };
  }

  /**
   * Départ volontaire, ou déconnexion (`voluntary = false`) : le joueur garde
   * alors sa place, même en lobby, pour pouvoir revenir avec son token.
   */
  leave(code: string, playerId: PlayerId, voluntary = true) {
    const room = this.rooms.get(code);
    const member = room?.members.find((m) => m.id === playerId);
    if (!room || !member) return;
    if (room.phase === 'lobby' && voluntary) {
      room.members = room.members.filter((m) => m !== member);
      if (!room.members.length) return this.remove(room);
    } else {
      member.connected = false;
    }
    if (room.hostId === playerId) {
      room.hostId = (room.members.find((m) => m.connected) ?? room.members[0]).id;
    }
    this.touch(room);
    if (room.phase === 'planning' && this.allReady(room)) return this.resolve(room);
    this.broadcast(room);
  }

  start(code: string, playerId: PlayerId) {
    const room = this.hostRoom(code, playerId);
    if (room.phase !== 'lobby') throw new RoomError('Partie déjà lancée');
    if (room.members.filter((m) => m.connected).length < MIN_PLAYERS) {
      throw new RoomError(`Il faut au moins ${MIN_PLAYERS} joueurs`);
    }
    room.members = room.members.filter((m) => m.connected);
    this.newGame(room);
  }

  rematch(code: string, playerId: PlayerId) {
    const room = this.hostRoom(code, playerId);
    if (room.phase !== 'over') throw new RoomError('La partie n’est pas terminée');
    // Les absents perdent leur place
    room.members = room.members.filter((m) => m.connected);
    room.lastResult = null;
    if (room.members.length >= MIN_PLAYERS) return this.newGame(room);
    room.phase = 'lobby';
    room.game = null;
    room.deadline = null;
    this.touch(room);
    this.broadcast(room);
  }

  submit(code: string, playerId: PlayerId, actions: unknown) {
    const room = this.rooms.get(code);
    if (!room || !room.game) throw new RoomError('Aucune partie en cours');
    if (room.phase !== 'planning') throw new RoomError('Ce n’est pas la phase de planification');
    const plan = cleanPlan(actions);
    const error = validatePlan(room.game, playerId, plan);
    if (error) throw new RoomError(error);
    room.plans.set(playerId, plan);
    this.touch(room);
    if (this.allReady(room)) return this.resolve(room);
    this.broadcast(room);
  }

  view(code: string, playerId: PlayerId): RoomView | null {
    const room = this.rooms.get(code);
    return room ? this.viewOf(room, playerId) : null;
  }

  /** Supprime les salles sans activité depuis idleMs. */
  purge(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (now - room.lastActivity > this.idleMs) this.remove(room);
    }
  }

  has(code: string) {
    return this.rooms.has(code);
  }

  private hostRoom(code: string, playerId: PlayerId): Room {
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('Salle introuvable');
    if (room.hostId !== playerId) throw new RoomError('Réservé à l’hôte');
    return room;
  }

  private newGame(room: Room) {
    room.game = createGame(room.members.map((m) => ({ id: m.id, name: m.name })));
    room.lastResult = null;
    this.planning(room);
  }

  private planning(room: Room) {
    room.phase = 'planning';
    room.plans.clear();
    this.schedule(room, this.planningMs, () => this.resolve(room));
    this.broadcast(room);
  }

  /** Tous les joueurs vivants et connectés ont soumis (et il en reste au moins un). */
  private allReady(room: Room): boolean {
    const waiting = room.game!.players.filter((p) => p.alive && room.members.find((m) => m.id === p.id)?.connected);
    return waiting.length > 0 && waiting.every((p) => room.plans.has(p.id));
  }

  private resolve(room: Room) {
    const result = resolveRound(room.game!, Object.fromEntries(room.plans));
    room.game = result.state;
    room.lastResult = result;
    room.plans.clear();
    for (const m of room.members) this.events.result(m.id, resultFor(result, m.id));
    if (result.state.over) {
      room.phase = 'over';
      this.schedule(room, null);
    } else {
      room.phase = 'revealing';
      this.schedule(room, this.revealMs, () => this.planning(room));
    }
    this.broadcast(room);
  }

  private schedule(room: Room, ms: number | null, fn?: () => void) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.deadline = ms === null ? null : Date.now() + ms;
    if (ms !== null && fn) room.timer = setTimeout(fn, ms);
  }

  private remove(room: Room) {
    this.schedule(room, null);
    this.rooms.delete(room.code);
  }

  private touch(room: Room) {
    room.lastActivity = Date.now();
  }

  private broadcast(room: Room) {
    for (const m of room.members) this.events.state(m.id, this.viewOf(room, m.id));
  }

  private viewOf(room: Room, you: PlayerId): RoomView {
    return {
      code: room.code,
      hostId: room.hostId,
      you,
      phase: room.phase,
      players: room.members.map((m, i) => ({
        id: m.id,
        name: m.name,
        color: room.game?.players.find((p) => p.id === m.id)?.color ?? i,
        connected: m.connected,
        ready: room.phase === 'planning' && room.plans.has(m.id),
      })),
      game: room.game && viewFor(room.game, you),
      deadline: room.deadline,
      serverNow: Date.now(),
      lastResult: room.lastResult && resultFor(room.lastResult, you),
      myPlan: (room.phase === 'planning' && room.plans.get(you)) || null,
    };
  }
}

function newId(): PlayerId {
  return randomBytes(6).toString('hex');
}
