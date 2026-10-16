import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import { maxFireballs, onCooldown, slotsFor } from '@dm/shared';
import type { Action, ActionType, ClientToServer, Dir, Mode, RoomView, ServerToClient } from '@dm/shared';

type Client = Socket<ServerToClient, ClientToServer>;

const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

/** Plan aléatoire mais valide : bonne longueur, boules de feu limitées, sorts à recharge 1 fois et si dispo. */
function randomPlan(view: RoomView): Action[] {
  const game = view.game!;
  const me = game.players.find((p) => p.id === view.you)!;
  const plan: Action[] = [];
  let fireballs = 0;
  const used = new Set<ActionType>();
  const spell = (type: ActionType) => {
    if (used.has(type) || onCooldown(game, me, type)) return false;
    used.add(type);
    return true;
  };
  const cell = () => Math.floor(Math.random() * game.size);
  while (plan.length < slotsFor(game)) {
    const r = Math.random();
    if (r < 0.25 && fireballs < maxFireballs(game)) {
      plan.push({ type: 'fireball', dir: pick(DIRS) });
      fireballs++;
    } else if (r < 0.35) {
      plan.push({ type: 'trap', dir: pick(DIRS) });
    } else if (r < 0.42 && spell('shield')) {
      plan.push({ type: 'shield' });
    } else if (r < 0.48 && spell('teleport')) {
      plan.push({ type: 'teleport', dx: pick([-2, -1, 1, 2]), dy: 0 });
    } else if (r < 0.54 && spell('meteor')) {
      plan.push({ type: 'meteor', x: cell(), y: cell() });
    } else if (r < 0.6 && spell('gust')) {
      plan.push({ type: 'gust' });
    } else if (r < 0.66 && spell('ice')) {
      plan.push({ type: 'ice', dir: pick(DIRS) });
    } else if (r < 0.93) {
      plan.push({ type: 'move', dir: pick(DIRS) });
    } else {
      plan.push({ type: 'wait' });
    }
  }
  return plan;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: String(port), PLANNING_MS: '1500', REVEAL_MS: '200' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const clients: Client[] = [];
function finish(code: number) {
  for (const c of clients) c.close();
  server.kill();
  process.exit(code);
}
setTimeout(() => {
  fail('Timeout : la partie ne s’est pas terminée');
  report();
}, 90_000).unref();

function report() {
  if (failures.length) {
    console.error(`SMOKE KO (${failures.length} erreurs)\n- ${failures.slice(0, 20).join('\n- ')}`);
    return finish(1);
  }
  console.log('SMOKE OK');
  finish(0);
}

// Attente du serveur
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${url}/health`)).ok) break;
  } catch {
    if (i > 100) {
      fail('Serveur injoignable');
      report();
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

const names = ['Alice', 'Bob', 'Carol'];
const call = <T>(c: Client, ev: string, ...args: unknown[]): Promise<T> =>
  new Promise((resolve) => (c.emit as (...a: unknown[]) => void)(ev, ...args, resolve));

/** Partie en cours : les vues d'une ancienne salle sont ignorées. */
let current = { code: '', mode: 'classic' as Mode, rounds: 0, over: new Set<string>(), done: () => {} };
const myId = new Map<Client, string>();
const myPlans = new Map<string, Action[]>();
for (const name of names) {
  const c: Client = io(url, { transports: ['websocket'] });
  clients.push(c);
  const submitted = new Set<string>();

  const submit = (plan: Action[], cancelAfter: boolean) => {
    myPlans.set(name, plan);
    c.emit('plan:submit', { actions: plan }, (res) => {
      if (!res.ok) return fail(`${name} : plan refusé (${res.error}) ${JSON.stringify(plan)}`);
      if (!cancelAfter) return;
      // Annule puis renvoie le même plan
      c.emit('plan:cancel', (res) => {
        if (!res.ok) return fail(`${name} : annulation refusée (${res.error})`);
        submit(plan, false);
      });
    });
  };

  c.on('room:state', (view) => {
    if (view.code !== current.code) return;
    const others = view.players.map((p) => p.id).filter((id) => id !== view.you);
    if (view.mode !== current.mode) fail(`${name} : mode ${view.mode} au lieu de ${current.mode}`);
    // Aucun piège d'un autre joueur
    const results = [...(view.lastResult ? [view.lastResult] : []), ...view.history];
    const traps = [...(view.game?.traps ?? []), ...results.flatMap((r) => [...r.start.traps, ...r.state.traps])];
    for (const t of traps) {
      if (t.owner !== view.you) fail(`${name} voit un piège de ${t.owner}`);
    }
    // Hors myPlan et résultats (révélés), la vue ne doit contenir aucune action
    const rest = JSON.stringify({ ...view, lastResult: null, history: null, myPlan: null });
    if (/"type":"(move|fireball|trap|teleport|shield|meteor|gust|ice|wait)"/.test(rest)) {
      fail(`${name} : action d'un autre joueur dans room:state (${view.phase})`);
    }
    if (view.myPlan && JSON.stringify(view.myPlan) !== JSON.stringify(myPlans.get(name))) fail(`${name} : myPlan incorrect`);
    for (const r of results) {
      if (r.steps.flat().some((e) => e.type === 'trapPlaced' && e.player !== view.you)) {
        fail(`${name} voit la pose d'un piège adverse (historique)`);
      }
      for (const id of others) {
        if ((r.plans[id] ?? []).some((a) => a.type === 'trap' && a.dir !== null)) fail(`${name} voit la direction d'un piège de ${id}`);
      }
    }
    if (view.phase === 'planning' && view.game && !submitted.has(`${view.code}:${view.game.round}`)) {
      const me = view.game.players.find((p) => p.id === view.you)!;
      if (!me.alive) return;
      submitted.add(`${view.code}:${view.game.round}`);
      // Manches impaires : Alice annule puis renvoie son plan avant que les autres ne valident
      const dance = view.game.round % 2 === 1;
      const plan = randomPlan(view);
      if (name === 'Alice') submit(plan, dance);
      else setTimeout(() => submit(plan, false), dance ? 100 : 0);
    }
    if (view.phase === 'over' && !current.over.has(name)) {
      current.over.add(name);
      if (view.history.length !== current.rounds) fail(`${name} : historique de ${view.history.length} manches au lieu de ${current.rounds}`);
      if (current.over.size === names.length) {
        console.log(`Partie ${current.mode} terminée en ${current.rounds} manches, gagnant : ${view.game!.winner ?? 'égalité'}`);
        current.done();
      }
    }
  });

  c.on('round:result', (result) => {
    if (name === 'Alice') current.rounds++;
    for (const e of result.steps.flat()) {
      if (e.type === 'trapPlaced' && e.player !== myId.get(c)) {
        fail(`${name} reçoit la pose de piège de ${e.player}`);
      }
    }
    if ([...result.start.traps, ...result.state.traps].some((t) => t.owner !== myId.get(c))) {
      fail(`${name} : piège adverse dans round:result`);
    }
  });
}

await Promise.all(clients.map((c) => new Promise((r) => c.on('connect', () => r(null)))));

async function play(mode: Mode) {
  const finished = new Promise<void>((done) => (current = { code: '', mode, rounds: 0, over: new Set(), done }));
  const created = await call<{ ok: boolean; code: string; you: string }>(clients[0], 'room:create', {
    name: 'Alice',
    token: 'smoke-a',
    mode,
  });
  if (!created.ok) fail('Création de salle échouée');
  current.code = created.code;
  myId.set(clients[0], created.you);
  for (let i = 1; i < 3; i++) {
    const res = await call<{ ok: boolean; you: string; error?: string }>(clients[i], 'room:join', {
      code: created.code,
      name: names[i],
      token: `smoke-${i}`,
    });
    if (!res.ok) fail(`Join ${names[i]} : ${res.error}`);
    myId.set(clients[i], res.you);
  }
  const started = await call<{ ok: boolean; error?: string }>(clients[0], 'game:start');
  if (!started.ok) fail(`Lancement : ${started.error}`);
  console.log(`Salle ${created.code} lancée (${mode})`);
  await finished;
}

await play('classic');
await play('chaos');
report();
