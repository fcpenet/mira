const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');
const { publisher, subscriber, CHANNEL } = require('../redis');
const config = require('../config');

/**
 * Attach socket.io to the HTTP server and configure:
 * - Redis adapter so events published by any server instance reach all connected clients
 * - JWT authentication on connection handshake
 * - Org-scoped rooms so clients only receive events for their organization
 */
function attachSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  // Use the Redis adapter for horizontal scaling across multiple server instances.
  // Each instance subscribes to the same Redis channel; socket.io handles fan-out
  // to local sockets in the matching room.
  io.adapter(createAdapter(publisher, subscriber));

  // ── Authentication middleware ──────────────────────────────────────────────
  // Clients must pass a valid JWT via handshake auth: { token: '<jwt>' }
  // or as a query param ?token=<jwt> (for environments where headers are unavailable).
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('authentication required'));
    }

    try {
      const payload = jwt.verify(token, config.jwtSecret);
      socket.user = {
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
  io.on('connection', (socket) => {
    const { orgId, email, role } = socket.user;

    // Each org gets its own room. Clients only receive events published to their org.
    socket.join(`org:${orgId}`);
    console.log(`[socket] connected: ${email} (role=${role}, org=${orgId}, id=${socket.id})`);

    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected: ${email} (${reason})`);
    });
  });

  // ── Redis → socket.io bridge ───────────────────────────────────────────────
  // The event ingest route publishes to CHANNEL. A dedicated subscriber client
  // listens here and emits to the correct org room. This runs on every server
  // instance, but socket.io's Redis adapter deduplicates delivery.
  subscriber.subscribe(CHANNEL, (err) => {
    if (err) console.error('[socket] Redis subscribe error:', err.message);
  });

  subscriber.on('message', (channel, message) => {
    if (channel !== CHANNEL) return;

    try {
      const data = JSON.parse(message);
      const roomId = `org:${data.event.org_id}`;

      io.to(roomId).emit('event', data);

      // Emit a separate high-priority alert for critical/high severity
      if (['critical', 'high'].includes(data.event.severity)) {
        io.to(roomId).emit('alert', data);
      }
    } catch (err) {
      console.error('[socket] failed to process Redis message:', err.message);
    }
  });

  return io;
}

module.exports = { attachSocketServer };
