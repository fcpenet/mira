const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { query } = require('../db');
const config    = require('../config');

const router = express.Router();
const SALT_ROUNDS = 12;

/**
 * POST /auth/register
 * Body: { email, password, orgId, role? }
 * Creates a new user in the given organization.
 * role defaults to 'operator'; only 'admin' can assign 'admin'.
 */
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, orgId, role = 'operator' } = req.body;

    if (!email || !password || !orgId) {
      return res.status(400).json({ error: 'email, password, and orgId are required' });
    }
    if (!['admin', 'operator', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'role must be admin, operator, or viewer' });
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
 * Returns a signed JWT valid for jwtExpiresIn.
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const { rows } = await query(
      'SELECT id, org_id, email, role, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const token = jwt.sign(
      { orgId: user.org_id, role: user.role, email: user.email },
      config.jwtSecret,
      { subject: user.id, expiresIn: config.jwtExpiresIn }
    );

    res.json({ token, user: { id: user.id, email: user.email, role: user.role, orgId: user.org_id } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
