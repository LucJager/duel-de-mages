export type Dir = 'up' | 'down' | 'left' | 'right';
export type Pos = { x: number; y: number };
export type PlayerId = string;

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'fireball'; dir: Dir }
  | { type: 'shield' }
  /** Décalage relatif, |dx| + |dy| entre 1 et TELEPORT_RANGE. */
  | { type: 'teleport'; dx: number; dy: number }
  /** Piège posé sur la case adjacente dans la direction donnée. */
  | { type: 'trap'; dir: Dir }
  | { type: 'wait' };

export type ActionType = Action['type'];

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** Index de couleur : 0 rouge, 1 bleu, 2 vert. */
  color: number;
  pos: Pos;
  hp: number;
  alive: boolean;
  /** Le prochain mouvement/téléport sera annulé (piège). */
  stunned: boolean;
  /** Première manche où le téléport est de nouveau disponible. */
  teleportReadyRound: number;
}

export interface Trap {
  owner: PlayerId;
  pos: Pos;
}

export interface GameState {
  size: number;
  /** Manche en cours de planification (commence à 1). */
  round: number;
  players: PlayerState[];
  traps: Trap[];
  over: boolean;
  /** Gagnant ; null si égalité (tout le monde meurt au même step). */
  winner: PlayerId | null;
}

export type GameEvent =
  | { type: 'shield'; player: PlayerId }
  | { type: 'move'; player: PlayerId; from: Pos; to: Pos; teleport: boolean }
  | { type: 'bonk'; players: PlayerId[]; at: Pos }
  | { type: 'wall'; player: PlayerId; at: Pos }
  | { type: 'stunned'; player: PlayerId }
  | { type: 'trapTriggered'; player: PlayerId; owner: PlayerId; at: Pos }
  | { type: 'trapPlaced'; player: PlayerId; at: Pos }
  | { type: 'fireball'; player: PlayerId; dir: Dir; path: Pos[]; hit: PlayerId | null }
  | { type: 'lava'; player: PlayerId; at: Pos }
  | { type: 'damage'; player: PlayerId; amount: number; hp: number }
  | { type: 'shieldBlock'; player: PlayerId }
  | { type: 'death'; player: PlayerId };

/** Action telle que révélée : la direction des pièges adverses reste secrète (dir: null). */
export type RevealedAction = Action | { type: 'trap'; dir: null };

export interface RoundResult {
  round: number;
  /** Les plans de chacun, révélés après la résolution. */
  plans: Record<PlayerId, RevealedAction[]>;
  /** steps[i] = événements du step i (0..2). Peut être plus court si la partie s'arrête. */
  steps: GameEvent[][];
  state: GameState;
}
