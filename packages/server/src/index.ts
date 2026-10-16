import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server, type Socket } from 'socket.io';
import type { ClientToServer, PlayerId, ServerToClient } from '@dm/shared';
import { RoomError, RoomManager, cleanCode } from './rooms';

type GameSocket = Socket<ClientToServer, ServerToClient, object, { code?: string; playerId?: PlayerId }>;

const port = Number(process.env.PORT ?? 3000);
const envMs = (v: string | undefined) => (v && Number(v) > 0 ? Number(v) : undefined);

const app = Fastify({ logger: true });
const io = new Server<ClientToServer, ServerToClient>(app.server);

const sockets = new Map<PlayerId, GameSocket>();
const rooms = new RoomManager(
  {
    state: (id, view) => sockets.get(id)?.emit('room:state', view),
    result: (id, result) => sockets.get(id)?.emit('round:result', result),
  },
  { planningMs: envMs(process.env.PLANNING_MS), revealMs: envMs(process.env.REVEAL_MS) },
);
setInterval(() => rooms.purge(), 60_000).unref();

// Fichiers du client + fallback SPA (ex : /r/ABCD → index.html)
const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => {
    // Seules les routes sans extension (pas les fichiers manquants) renvoient l'app
    const path = req.url.split('?')[0];
    if (req.method === 'GET' && !path.startsWith('/socket.io') && !/\.\w+$/.test(path)) return reply.sendFile('index.html');
    reply.code(404).send({ error: 'Not found' });
  });
} else {
  app.log.warn(`Client non buildé (${dist} absent) : fichiers statiques désactivés`);
}

app.get('/health', async () => ({ ok: true }));

io.on('connection', (raw) => {
  const socket = raw as GameSocket;

  /** Exécute un handler et renvoie le résultat dans l'ack (si fournie). */
  const handle = (ack: unknown, fn: () => object | void) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      reply({ ok: true, ...fn() });
    } catch (e) {
      if (!(e instanceof RoomError)) app.log.error(e);
      reply({ ok: false, error: e instanceof RoomError ? e.message : 'Erreur serveur' });
    }
  };

  const bound = () => {
    const { code, playerId } = socket.data;
    if (!code || !playerId) throw new RoomError('Pas dans une salle');
    return { code, playerId };
  };

  /** `voluntary` : départ explicite (sinon simple déconnexion, la place est gardée). */
  const detach = (voluntary = true) => {
    const { code, playerId } = socket.data;
    socket.data = {};
    if (!code || !playerId || sockets.get(playerId) !== socket) return;
    sockets.delete(playerId);
    rooms.leave(code, playerId, voluntary);
  };

  const attach = (code: string, playerId: PlayerId) => {
    const old = sockets.get(playerId);
    // Même joueur dans un autre onglet : l'ancien socket est détaché
    if (old && old !== socket) old.data = {};
    socket.data = { code, playerId };
    sockets.set(playerId, socket);
    const view = rooms.view(code, playerId);
    if (view) socket.emit('room:state', view);
  };

  socket.on('room:create', (p, ack) =>
    handle(ack, () => {
      detach();
      const res = rooms.create(p?.name, p?.token);
      attach(res.code, res.you);
      return res;
    }),
  );

  socket.on('room:join', (p, ack) =>
    handle(ack, () => {
      const res = rooms.join(p?.code, p?.name, p?.token);
      const code = cleanCode(p.code);
      if (socket.data.playerId !== res.you) detach();
      attach(code, res.you);
      return res;
    }),
  );

  socket.on('room:leave', () => handle(null, () => detach()));

  socket.on('game:start', (ack) =>
    handle(ack, () => {
      const { code, playerId } = bound();
      rooms.start(code, playerId);
    }),
  );

  socket.on('plan:submit', (p, ack) =>
    handle(ack, () => {
      const { code, playerId } = bound();
      rooms.submit(code, playerId, p?.actions);
    }),
  );

  socket.on('game:rematch', (ack) =>
    handle(ack, () => {
      const { code, playerId } = bound();
      rooms.rematch(code, playerId);
    }),
  );

  socket.on('disconnect', () => detach(false));
});

await app.listen({ port, host: '0.0.0.0' });
