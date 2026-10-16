import type { Action, GameState, Mode, PlayerId, RoundResult } from './types';

export type RoomPhase = 'lobby' | 'planning' | 'revealing' | 'over';

export interface RoomPlayer {
  id: PlayerId;
  name: string;
  color: number;
  connected: boolean;
  /** A validé son plan pour la manche en cours. */
  ready: boolean;
}

/** Vue d'une salle envoyée à un joueur (déjà filtrée pour lui). */
export interface RoomView {
  code: string;
  hostId: PlayerId;
  you: PlayerId;
  phase: RoomPhase;
  mode: Mode;
  players: RoomPlayer[];
  game: GameState | null;
  /** Timestamp (ms epoch, horloge serveur) de fin de la phase en cours. */
  deadline: number | null;
  /** Horloge serveur au moment de l'envoi, pour corriger le décalage. */
  serverNow: number;
  /** Manches résolues de la partie en cours, de la plus ancienne à la plus récente (filtrées pour moi). */
  history: RoundResult[];
  /** Mon plan déjà soumis pour la manche en cours. */
  myPlan: Action[] | null;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServer {
  'room:create': (p: { name: string; token: string; mode: Mode }, ack: Ack<{ code: string; you: PlayerId }>) => void;
  'room:join': (p: { code: string; name: string; token: string }, ack: Ack<{ you: PlayerId }>) => void;
  'room:leave': () => void;
  'game:start': (ack: Ack) => void;
  /** Exactement slotsFor(game) actions. */
  'plan:submit': (p: { actions: Action[] }, ack: Ack) => void;
  /** Retire mon plan validé tant que la planification dure. */
  'plan:cancel': (ack: Ack) => void;
  'game:rematch': (ack: Ack) => void;
}

export interface ServerToClient {
  'room:state': (view: RoomView) => void;
  /** Émis une fois à la fin de chaque planification, avant le passage en phase « revealing ». */
  'round:result': (result: RoundResult) => void;
}
