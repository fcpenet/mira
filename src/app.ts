import express from 'express';
import { errorHandler } from './middleware/errorHandler';
import authRouter    from './routes/auth';
import devicesRouter from './routes/devices';
import eventsRouter  from './routes/events';

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/auth',    authRouter);
app.use('/devices', devicesRouter);
app.use('/events',  eventsRouter);

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

app.use(errorHandler);

export default app;
