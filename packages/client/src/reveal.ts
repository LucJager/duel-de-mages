import { samePos } from '@dm/shared';
import type { GameEvent, GameState, PlayerId, Pos, Trap } from '@dm/shared';

export interface MageView {
  pos: Pos;
  hp: number;
  alive: boolean;
}

/** État affiché pendant la révélation. */
export interface Display {
  mages: Record<PlayerId, MageView>;
  traps: Trap[];
}

export function displayFrom(state: GameState): Display {
  return {
    mages: Object.fromEntries(state.players.map((p) => [p.id, { pos: p.pos, hp: p.hp, alive: p.alive }])),
    traps: state.traps,
  };
}

/** Applique les événements d'un step à l'état affiché. Fonction pure. */
export function applyStep(d: Display, events: GameEvent[]): Display {
  const mages = Object.fromEntries(Object.entries(d.mages).map(([id, m]) => [id, { ...m }]));
  let traps = d.traps;
  for (const e of events) {
    switch (e.type) {
      case 'move':
        mages[e.player].pos = e.to;
        break;
      case 'trapTriggered':
        traps = traps.filter((t) => !samePos(t.pos, e.at));
        break;
      case 'trapPlaced':
        traps = [...traps.filter((t) => t.owner !== e.player), { owner: e.player, pos: e.at }];
        break;
      case 'damage':
        mages[e.player].hp = e.hp;
        break;
      case 'death':
        mages[e.player].alive = false;
        break;
    }
  }
  // Les pièges d'un mage mort disparaissent
  traps = traps.filter((t) => mages[t.owner]?.alive ?? true);
  return { mages, traps };
}

/** Délai (ms dans le step) auquel chaque type d'événement est joué. */
export const EVENT_DELAY: Record<GameEvent['type'], number> = {
  shield: 0,
  stunned: 0,
  wall: 150,
  bonk: 150,
  move: 0,
  trapTriggered: 350,
  trapPlaced: 350,
  fireball: 400,
  lava: 700,
  damage: 750,
  shieldBlock: 750,
  death: 900,
};

export const PLANS_MS = 1500;
export const STEP_MS = 1200;
export const OUTRO_MS = 700;
