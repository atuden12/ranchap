#!/usr/bin/env node
/**
 * One-command deploy: stage all changes → commit → push to GitHub.
 * GitHub auto-deploys to Vercel from there.
 *
 * Usage:
 *   npm run deploy -- "what you changed"
 *   npm run deploy                            # uses a timestamped default message
 *
 * Refuses to push secrets — bails if .env or *.db sneaks into staged changes.
 */
import { execSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2).join(' ').trim();
const msg = args || `update ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`;

function git(cmd, opts = {}) {
  return execSync(`git ${cmd}`, { encoding: 'utf8', ...opts }).trim();
}

function gitInherit(cmd) {
  const result = spawnSync('git', cmd.split(' '), { stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// --- 1. Verify we're inside a git repo with an upstream ---
try {
  git('rev-parse --is-inside-work-tree');
} catch {
  console.error('Not a git repository. Run `git init` and configure a remote first.');
  process.exit(1);
}

const branch = git('rev-parse --abbrev-ref HEAD');
console.log(`On branch: ${branch}`);

// --- 2. Stage everything ---
gitInherit('add .');

// --- 3. Bail if nothing to commit ---
const staged = git('diff --cached --name-only');
if (!staged) {
  console.log('Nothing to commit — working tree clean.');
  process.exit(0);
}

// --- 4. Guard against committing secrets ---
const danger = staged.split('\n').filter((f) => /(^|\/)\.env(\..+)?$|\.db$|ranch-data/.test(f));
if (danger.length > 0) {
  console.error('\nRefusing to commit — these look like secrets / data files:');
  for (const f of danger) console.error('  • ' + f);
  console.error('\nUnstage them with: git restore --staged <file>');
  console.error('Then check your .gitignore.');
  process.exit(1);
}

// --- 5. Show what's about to ship ---
console.log('\nStaged changes:');
const stats = git('diff --cached --stat');
console.log(stats);
console.log('');

// --- 6. Commit + push ---
gitInherit(`commit -m "${msg.replace(/"/g, '\\"')}"`);
gitInherit('push');

console.log('\n✓ Pushed to GitHub.');
console.log('  Vercel auto-deploy should start within 30 seconds.');
console.log('  Watch: https://vercel.com/dashboard');
