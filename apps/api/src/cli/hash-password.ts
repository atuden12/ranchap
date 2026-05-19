#!/usr/bin/env node
/**
 * Generate a bcrypt hash for APP_PASSWORD_HASH env var.
 *
 * Usage:
 *   npm run hash-password -- "your-password-here"
 *
 * Then paste the output into your .env / fly secrets / wherever env vars live.
 */
import bcrypt from 'bcryptjs';

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your-password"');
  process.exit(2);
}

const hash = bcrypt.hashSync(password, 12);
console.log(hash);
