import { Request, Response, NextFunction } from 'express';

interface PostgresError extends Error {
  code?: string;
  status?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: PostgresError, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[error]', err.message);

  if (err.code === '23505') {
    res.status(409).json({ error: 'resource already exists' });
    return;
  }
  if (err.code === '23503') {
    res.status(400).json({ error: 'referenced resource not found' });
    return;
  }

  const status = err.status ?? 500;
  const message = status < 500 ? err.message : 'internal server error';
  res.status(status).json({ error: message });
}
