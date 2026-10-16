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
  /** Case absolue visée, n'importe où dans l'arène. */
  | { type: 'meteor'; x: number; y: number }
  /** Repousse d'une case les mages sur les 4 cases adjacentes. */
  | { type: 'gust' }
  /** Bloc de glace posé sur la case adjacente dans la direction donnée. */
  | { type: 'ice'; dir: Dir }
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
  /** Première manche où chaque sort à recharge est de nouveau disponible (absent = disponible). */
  ready: Partial<Record<ActionType, number>>;
}

export interface Trap {
  owner: PlayerId;
  pos: Pos;
}

export interface Ice {
  pos: Pos;
  owner: PlayerId;
  /** Fond à la fin de cette manche. */
  expires: number;
}

export type Mode = 'classic' | 'chaos';
/** Bonus de manche du mode Chaos, le même pour tout le monde. */
export type Bonus = 'fireRain' | 'recharge' | 'heal' | 'haste';

export interface GameState {
  size: number;
  mode: Mode;
  /** Bonus de la manche en cours (mode Chaos), null sinon. */
  bonus: Bonus | null;
  /** Manche en cours de planification (commence à 1). */
  round: number;
  players: PlayerState[];
  traps: Trap[];
  /** Blocs de glace, visibles de tous. */
  ice: Ice[];
  over: boolean;
  /** Gagnant ; null si égalité (tout le monde meurt au même step). */
  winner: PlayerId | null;
}

export type GameEvent =
  | { type: 'shield'; player: PlayerId }
  | { type: 'move'; player: PlayerId; from: Pos; to: Pos; kind: 'walk' | 'teleport' | 'push' }
  | { type: 'bonk'; players: PlayerId[]; at: Pos }
  | { type: 'wall'; player: PlayerId; at: Pos }
  | { type: 'stunned'; player: PlayerId }
  | { type: 'trapTriggered'; player: PlayerId; owner: PlayerId; at: Pos }
  | { type: 'trapPlaced'; player: PlayerId; at: Pos }
  | { type: 'gust'; player: PlayerId }
  | { type: 'icePlaced'; player: PlayerId; at: Pos }
  | { type: 'iceMelted'; at: Pos }
  | { type: 'meteor'; player: PlayerId; at: Pos; hit: PlayerId | null }
  | { type: 'fireball'; player: PlayerId; dir: Dir; path: Pos[]; hit: PlayerId | null }
  | { type: 'lava'; player: PlayerId; at: Pos }
  | { type: 'damage'; player: PlayerId; amount: number; hp: number }
  | { type: 'shieldBlock'; player: PlayerId }
  | { type: 'death'; player: PlayerId };

/** Action telle que révélée : la direction des pièges adverses reste secrète (dir: null). */
export type RevealedAction = Action | { type: 'trap'; dir: null };

export interface RoundResult {
  round: number;
  /** État avant la manche (pour rejouer l'animation et l'historique). */
  start: GameState;
  /** Les plans de chacun, révélés après la résolution. */
  plans: Record<PlayerId, RevealedAction[]>;
  /**
   * steps[i] = événements du step i. Peut être plus court si la partie s'arrête.
   * Les effets de fin de manche (lave, fonte de la glace) sont ajoutés au dernier step.
   */
  steps: GameEvent[][];
  state: GameState;
}
