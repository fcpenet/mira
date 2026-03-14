import express from 'express';
import { errorHandler } from './middleware/errorHandler';
import authRouter    from './routes/auth';
import devicesRouter from './routes/devices';
import eventsRouter  from './routes/events';

const app = express();

app.use(express.json());

// Set sticky session cookie so Nginx can route the client back to this instance.
// Uses HOSTNAME (set by Docker to the container name) as the instance identifier.
// Cookie is HttpOnly and SameSite=Strict; omit Secure for local HTTP dev.
const INSTANCE_ID = process.env.HOSTNAME ?? 'local';
app.use((_req, res, next) => {
  if (!_req.headers.cookie?.includes('MIRASRV')) {
    res.cookie('MIRASRV', INSTANCE_ID, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/auth',    authRouter);
app.use('/devices', devicesRouter);
app.use('/events',  eventsRouter);

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

app.use(errorHandler);

export default app;
