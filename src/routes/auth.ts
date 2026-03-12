import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../db';
import config from '../config';
import { UserRole } from '../types';

const router = Router();
const SALT_ROUNDS = 12;

/**
 * POST /auth/register
 * Body: { email, password, orgId, role? }
 */
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, orgId, role = 'operator' } = req.body as {
      email: string;
      password: string;
      orgId: string;
      role?: UserRole;
    };

    if (!email || !password || !orgId) {
      res.status(400).json({ error: 'email, password, and orgId are required' });
      return;
    }
    if (!(['admin', 'operator', 'viewer'] as UserRole[]).includes(role)) {
      res.status(400).json({ error: 'role must be admin, operator, or viewer' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const { rows } = await query(
      `INSERT INTO users (org_id, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, org_id, email, role, created_at`,
      [orgId, email.toLowerCase(), passwordHash, role]
    );

    res.status(201).json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/login
 * Body: { email, password }
 * Returns a signed JWT.
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    const { rows } = await query<{
      id: string;
      org_id: string;
      email: string;
      role: UserRole;
      password_hash: string;
    }>(
      'SELECT id, org_id, email, role, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    const user = rows[0];
    if (!user) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const signOptions: jwt.SignOptions = {
      subject:   user.id,
      expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    };
    const token = jwt.sign(
      { orgId: user.org_id, role: user.role, email: user.email },
      config.jwtSecret,
      signOptions
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, orgId: user.org_id },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
