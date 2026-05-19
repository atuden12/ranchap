import { Router } from 'express';
import {
  AUTH_ENABLED,
  AUTH_USERNAME,
  verifyPassword,
  isUsernameMatch,
} from '../auth.js';

export const authRouter = Router();

/**
 * GET /api/auth/me
 * Returns { authenticated, username, auth_enabled }.
 * The frontend uses this on boot to decide whether to show the login screen.
 */
authRouter.get('/me', (req, res) => {
  if (!AUTH_ENABLED) {
    res.json({ authenticated: true, username: 'dev', auth_enabled: false });
    return;
  }
  if (req.session?.user) {
    res.json({ authenticated: true, username: req.session.user, auth_enabled: true });
    return;
  }
  res.status(200).json({ authenticated: false, auth_enabled: true });
});

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Sets a signed session cookie on success.
 */
authRouter.post('/login', async (req, res) => {
  const body = req.body as { username?: string; password?: string };
  if (!body.username || !body.password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }
  if (!AUTH_ENABLED) {
    res.status(503).json({ error: 'auth not configured on server' });
    return;
  }
  if (!isUsernameMatch(body.username)) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  const ok = await verifyPassword(body.password);
  if (!ok) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  req.session.user = AUTH_USERNAME!;
  res.json({ ok: true, username: AUTH_USERNAME });
});

/**
 * POST /api/auth/logout
 * Destroys the session and clears the cookie.
 */
authRouter.post('/logout', (req, res) => {
  if (!req.session) {
    res.json({ ok: true });
    return;
  }
  req.session.destroy(() => {
    res.clearCookie('ranchapp.sid');
    res.json({ ok: true });
  });
});
