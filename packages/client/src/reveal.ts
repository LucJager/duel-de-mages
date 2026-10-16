import { samePos } from '@dm/shared';
import type { GameEvent, GameState, PlayerId, Pos, RoundResult, Trap } from '@dm/shared';

export interface MageView {
  pos: Pos;
  hp: number;
  alive: boolean;
}

/** État affiché pendant la révélation. */
export interface Display {
  mages: Record<PlayerId, MageView>;
  traps: Trap[];
  ice: Pos[];
}

export function displayFrom(state: GameState): Display {
  return {
    mages: Object.fromEntries(state.players.map((p) => [p.id, { pos: p.pos, hp: p.hp, alive: p.alive }])),
    traps: state.traps,
    ice: state.ice.map((i) => i.pos),
  };
}

/** Applique les événements d'un step à l'état affiché. Fonction pure. */
export function applyStep(d: Display, events: GameEvent[]): Display {
  const mages = Object.fromEntries(Object.entries(d.mages).map(([id, m]) => [id, { ...m }]));
  let traps = d.traps;
  let ice = d.ice;
  for (const e of events) {
    switch (e.type) {
      case 'move':
        mages[e.player].pos = e.to;
        break;
      case 'trapTriggered':
        traps = traps.filter((t) => !(t.owner === e.owner && samePos(t.pos, e.at)));
        break;
      case 'trapPlaced':
        traps = [...traps.filter((t) => t.owner !== e.player), { owner: e.player, pos: e.at }];
        break;
      case 'icePlaced':
        ice = [...ice, e.at];
        break;
      case 'iceMelted':
        ice = ice.filter((p) => !samePos(p, e.at));
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
  return { mages, traps, ice };
}

/** Résumé texte des événements marquants d'une manche (historique). */
export function summarize(result: RoundResult): string[] {
  const name = (id: PlayerId) => result.start.players.find((p) => p.id === id)?.name ?? '?';
  const out: string[] = [];
  result.steps.forEach((events, i) => {
    // Les effets de fin de manche (lave) sont ajoutés à la fin du dernier step
    let prefix = `Action ${i + 1}`;
    const add = (text: string) => out.push(`${prefix} : ${text}`);
    for (const e of events) {
      switch (e.type) {
        case 'fireball':
          if (e.hit) add(`${name(e.player)} touche ${name(e.hit)} (boule de feu)`);
          break;
        case 'meteor':
          if (e.hit) add(e.hit === e.player ? `${name(e.player)} reçoit son propre météore` : `météore de ${name(e.player)} sur ${name(e.hit)}`);
          break;
        case 'bonk':
          add(`BONK ! ${e.players.map(name).join(' et ')}`);
          break;
        case 'trapTriggered':
          add(`${name(e.player)} tombe dans le piège de ${name(e.owner)}`);
          break;
        case 'move':
          if (e.kind === 'push') add(`${name(e.player)} est repoussé par la bourrasque`);
          break;
        case 'shieldBlock':
          add(`le bouclier de ${name(e.player)} bloque le coup`);
          break;
        case 'lava':
          prefix = 'Fin de manche';
          add(`${name(e.player)} brûle dans la lave`);
          break;
        case 'death':
          add(`${name(e.player)} est K.O. !`);
          break;
      }
    }
  });
  return out;
}

/** Délai (ms dans le step) auquel chaque type d'événement est joué. */
export const EVENT_DELAY: Record<GameEvent['type'], number> = {
  shield: 0,
  stunned: 0,
  wall: 150,
  bonk: 150,
  move: 0,
  gust: 250,
  trapTriggered: 350,
  trapPlaced: 350,
  icePlaced: 350,
  fireball: 400,
  meteor: 400,
  lava: 700,
  damage: 750,
  shieldBlock: 750,
  death: 900,
  iceMelted: 1000,
};

export const PLANS_MS = 1500;
export const STEP_MS = 1200;
export const OUTRO_MS = 700;
