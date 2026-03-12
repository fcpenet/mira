import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { publisher, subscriber, CHANNEL } from '../redis';
import config from '../config';
import { AuthUser, UserRole } from '../types';

// Typed socket.io event maps
interface ServerToClientEvents {
  event: (data: EventPayload) => void;
  alert: (data: EventPayload) => void;
}

interface ClientToServerEvents {
  // No client-initiated events in this version
}

interface SocketData {
  user: AuthUser;
}

interface EventPayload {
  event: {
    id: string;
    org_id: string;
    device_id: string;
    type: string;
    severity: string;
    payload: Record<string, unknown>;
    created_at: string;
  };
  device: {
    id: string;
    name: string;
    type: string;
  };
}

interface JwtPayload {
  sub: string;
  orgId: string;
  role: UserRole;
  email: string;
}

type MiraSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export function attachSocketServer(httpServer: HttpServer): void {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  io.adapter(createAdapter(publisher, subscriber));

  // ── Authentication middleware ──────────────────────────────────────────────
  io.use((socket: MiraSocket, next) => {
    const token = (socket.handshake.auth as { token?: string })?.token
      ?? (socket.handshake.query as { token?: string })?.token;

    if (!token) {
      return next(new Error('authentication required'));
    }

    try {
      const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
      socket.data.user = {
        id:    payload.sub,
        orgId: payload.orgId,
        role:  payload.role,
        email: payload.email,
      };
      next();
    } catch {
      next(new Error('invalid or expired token'));
    }
  });

  // ── Connection handler ─────────────────────────────────────────────────────
  io.on('connection', (socket: MiraSocket) => {
    const { orgId, email, role } = socket.data.user;

    socket.join(`org:${orgId}`);
    console.log(`[socket] connected: ${email} (role=${role}, org=${orgId}, id=${socket.id})`);

    socket.on('disconnect', (reason: string) => {
      console.log(`[socket] disconnected: ${email} (${reason})`);
    });
  });

  // ── Redis → socket.io bridge ───────────────────────────────────────────────
  subscriber.subscribe(CHANNEL, (err) => {
    if (err) console.error('[socket] Redis subscribe error:', err.message);
  });

  subscriber.on('message', (channel: string, message: string) => {
    if (channel !== CHANNEL) return;

    try {
      const data = JSON.parse(message) as EventPayload;
      const roomId = `org:${data.event.org_id}`;

      io.to(roomId).emit('event', data);

      if (['critical', 'high'].includes(data.event.severity)) {
        io.to(roomId).emit('alert', data);
      }
    } catch (err) {
      console.error('[socket] failed to process Redis message:', (err as Error).message);
    }
  });
}
