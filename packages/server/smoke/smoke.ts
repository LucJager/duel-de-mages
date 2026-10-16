import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import type { Action, ClientToServer, Dir, RoomView, ServerToClient } from '@dm/shared';

type Client = Socket<ServerToClient, ClientToServer>;

const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

/** Plan aléatoire mais valide : au plus 2 boules de feu, 1 bouclier, 1 téléport (si dispo). */
function randomPlan(view: RoomView): Action[] {
  const me = view.game!.players.find((p) => p.id === view.you)!;
  const plan: Action[] = [];
  let fireballs = 0;
  let shield = false;
  let teleport = me.teleportReadyRound > view.game!.round;
  while (plan.length < 3) {
    const r = Math.random();
    if (r < 0.3 && fireballs < 2) {
      plan.push({ type: 'fireball', dir: pick(DIRS) });
      fireballs++;
    } else if (r < 0.45) {
      plan.push({ type: 'trap', dir: pick(DIRS) });
    } else if (r < 0.55 && !shield) {
      plan.push({ type: 'shield' });
      shield = true;
    } else if (r < 0.62 && !teleport) {
      plan.push({ type: 'teleport', dx: pick([-2, -1, 1, 2]), dy: 0 });
      teleport = true;
    } else if (r < 0.92) {
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
}, 60_000).unref();

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

const myId = new Map<Client, string>();
let rounds = 0;
const myPlans = new Map<string, Action[]>();
let over = 0;
for (const name of names) {
  const c: Client = io(url, { transports: ['websocket'] });
  clients.push(c);
  const submitted = new Set<number>();

  c.on('room:state', (view) => {
    const others = view.players.map((p) => p.id).filter((id) => id !== view.you);
    // Aucun piège d'un autre joueur
    for (const t of [...(view.game?.traps ?? []), ...(view.lastResult?.state.traps ?? [])]) {
      if (t.owner !== view.you) fail(`${name} voit un piège de ${t.owner}`);
    }
    // Hors myPlan et lastResult (révélé), la vue ne doit contenir aucune action
    if (/"type":"(move|fireball|trap|teleport|shield|wait)"/.test(JSON.stringify({ ...view, lastResult: null, myPlan: null }))) {
      fail(`${name} : action d'un autre joueur dans room:state (${view.phase})`);
    }
    if (view.myPlan && JSON.stringify(view.myPlan) !== JSON.stringify(myPlans.get(name))) fail(`${name} : myPlan incorrect`);
    for (const id of others) {
      const revealed = view.lastResult?.plans[id] ?? [];
      if (revealed.some((a) => a.type === 'trap' && a.dir !== null)) fail(`${name} voit la direction d'un piège de ${id}`);
    }
    if (view.phase === 'planning' && view.game && !submitted.has(view.game.round)) {
      const me = view.game.players.find((p) => p.id === view.you)!;
      if (!me.alive) return;
      submitted.add(view.game.round);
      const plan = randomPlan(view);
      myPlans.set(name, plan);
      c.emit('plan:submit', { actions: plan }, (res) => {
        if (!res.ok) fail(`${name} : plan refusé (${res.error}) ${JSON.stringify(plan)}`);
      });
    }
    if (view.phase === 'over' && ++over === names.length) {
      console.log(`Partie terminée en ${rounds} manches, gagnant : ${view.game!.winner ?? 'égalité'}`);
      report();
    }
  });

  c.on('round:result', (result) => {
    if (name === 'Alice') rounds++;
    for (const e of result.steps.flat()) {
      if (e.type === 'trapPlaced' && e.player !== myId.get(c)) {
        fail(`${name} reçoit la pose de piège de ${e.player}`);
      }
    }
    if (result.state.traps.some((t) => t.owner !== myId.get(c))) fail(`${name} : piège adverse dans round:result`);
  });
}

await Promise.all(clients.map((c) => new Promise((r) => c.on('connect', () => r(null)))));

const created = await call<{ ok: boolean; code: string; you: string }>(clients[0], 'room:create', { name: 'Alice', token: 'smoke-a' });
if (!created.ok) fail('Création de salle échouée');
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
console.log(`Salle ${created.code} lancée`);
