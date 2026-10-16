import type { ActionType, Bonus, Dir, Pos } from './types';

export const MAX_HP = 3;
export const SLOTS = 3;
export const MAX_FIREBALLS_PER_ROUND = 2;
export const TELEPORT_RANGE = 2;
/** Sorts à recharge (1 fois par manche max) : utilisé à la manche r → de nouveau disponible à r + n. */
export const COOLDOWNS: Partial<Record<ActionType, number>> = { teleport: 2, shield: 2, meteor: 2, gust: 2, ice: 2 };
export const BONUSES: Bonus[] = ['fireRain', 'recharge', 'heal', 'haste'];
/** Manche à partir de laquelle l'anneau i (0 = extérieur) devient de la lave. */
export const LAVA_ROUNDS = [6, 9, 12];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 3;
export const PLANNING_MS = 30_000;
/** Durée laissée aux clients pour jouer l'animation de révélation. */
export const REVEAL_MS = 8_000;
export const ROOM_IDLE_MS = 30 * 60_000;

export const COLORS = ['red', 'blue', 'green'] as const;

export const DIRS: Record<Dir, Pos> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function boardSize(playerCount: number): number {
  return playerCount >= 3 ? 6 : 5;
}
