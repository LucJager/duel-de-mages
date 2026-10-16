import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@dm/shared';

// Même origine en prod ; proxy Vite en dev.
export const socket: Socket<ServerToClient, ClientToServer> = io();
