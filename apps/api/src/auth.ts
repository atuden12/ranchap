import type { RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import session from 'express-session';

declare module 'express-session' {
  interface SessionData {
    user?: string;
  }
}

/**
 * Auth configured via three env vars:
 *   APP_USERNAME       — single shared username
 *   APP_PASSWORD_HASH  — bcrypt hash of the password (use `npm run hash-password`)
 *   SESSION_SECRET     — random 32+ char string for signing session cookies
 *
 * In dev without these set, auth defaults to OPEN (no login required) so
 * local-only work isn't gated. Production deploys MUST set all three.
 */
export const AUTH_USERNAME = process.env.APP_USERNAME;
export const AUTH_PASSWORD_HASH = process.env.APP_PASSWORD_HASH;
export const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-do-not-deploy';

/** True when env is configured for auth. False = open access (dev/local). */
export const AUTH_ENABLED = Boolean(AUTH_USERNAME && AUTH_PASSWORD_HASH);

export function sessionMiddleware(): RequestHandler {
  return session({
    name: 'ranchapp.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  });
}

/** Require an authenticated session for /api/* routes (excluding /api/auth/*). */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!AUTH_ENABLED) return next(); // dev mode: no auth
  if (req.path.startsWith('/auth/')) return next();
  if (req.session?.user) return next();
  res.status(401).json({ error: 'unauthenticated' });
};

export async function verifyPassword(submittedPassword: string): Promise<boolean> {
  if (!AUTH_PASSWORD_HASH) return false;
  try {
    return await bcrypt.compare(submittedPassword, AUTH_PASSWORD_HASH);
  } catch {
    return false;
  }
}

export function isUsernameMatch(submitted: string): boolean {
  return submitted === AUTH_USERNAME;
}
