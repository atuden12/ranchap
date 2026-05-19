import { spawn } from 'node:child_process';
import { REPO_ROOT } from './paths.js';

export interface ImportResult {
  ok: boolean;
  exit_code: number;
  /** Parsed `===== IMPORT SUMMARY =====` JSON block, when extractable. */
  summary: Record<string, unknown> | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the CLI importer as a subprocess. Spawning is preferred over importing
 * the script as a module because the CLI calls `process.exit` and has heavy
 * module-level state — wrapping it cleanly would be a larger refactor.
 *
 * Pass an absolute path to the xlsx (e.g. multer temp file).
 */
export function runImport(absoluteFilePath: string): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, INIT_CWD: REPO_ROOT };
    const child = spawn('npm', ['run', 'import', '--', '--file', absoluteFilePath], {
      cwd: REPO_ROOT,
      shell: true, // needed for npm.cmd on Windows
      env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      const summary = extractSummaryJson(stdout);
      resolve({
        ok: code === 0,
        exit_code: code ?? -1,
        summary,
        stdout,
        stderr,
      });
    });
  });
}

function extractSummaryJson(stdout: string): Record<string, unknown> | null {
  // Find the JSON block between the IMPORT SUMMARY banners.
  const match = stdout.match(
    /===== IMPORT SUMMARY =====\s*([\s\S]*?)\s*===+/,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]!.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
