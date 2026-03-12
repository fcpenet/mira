const express = require('express');
const errorHandler = require('./middleware/errorHandler');

const authRouter    = require('./routes/auth');
const devicesRouter = require('./routes/devices');
const eventsRouter  = require('./routes/events');

const app = express();

app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',    authRouter);
app.use('/devices', devicesRouter);
app.use('/events',  eventsRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
