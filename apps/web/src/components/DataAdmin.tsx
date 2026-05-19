import { useState } from 'react';
import { uploadImportXlsx } from '../lib/api';

export function DataAdmin({ onImported }: { onImported?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    summary: Record<string, unknown> | null;
    stdout_tail?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadImportXlsx(file);
      setResult({ summary: res.summary, stdout_tail: res.stdout_tail });
      onImported?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold tracking-tight">Data Admin</h2>
        <p className="text-xs text-muted-foreground">
          Import a fresh Stock_Flow_MASTER workbook or back up the database.
        </p>
      </div>

      <div className="grid gap-4 px-4 py-4 lg:grid-cols-2">
        {/* Import card */}
        <section className="space-y-3 rounded-md border border-border bg-background/40 p-4">
          <div>
            <h3 className="text-sm font-semibold">Import xlsx</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Wipe-and-replace import — actual + forecast rows come from the file. Predicted UI
              entries are preserved.
            </p>
          </div>
          <input
            type="file"
            accept=".xlsx,.xlsm"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
            className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
          />
          <button
            onClick={upload}
            disabled={!file || busy}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Importing… (this can take 10-20s)' : 'Run import'}
          </button>

          {error && (
            <pre className="overflow-x-auto rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-[11px] whitespace-pre-wrap">
              {error}
            </pre>
          )}

          {result && (
            <details className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs" open>
              <summary className="cursor-pointer font-medium">
                Import complete — click to view summary
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px]">
                {JSON.stringify(result.summary, null, 2)}
              </pre>
            </details>
          )}
        </section>

        {/* Backup card */}
        <section className="space-y-3 rounded-md border border-border bg-background/40 p-4">
          <div>
            <h3 className="text-sm font-semibold">Back up database</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Downloads a consistent snapshot of <code>ranch.db</code> (uses SQLite
              <code> VACUUM INTO</code>, so it's safe to run during use).
            </p>
          </div>
          <a
            href="/api/admin/backup"
            className="inline-flex w-full justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
            download
          >
            Download backup
          </a>
          <p className="text-[11px] text-muted-foreground">
            Tip: schedule this in your OS task scheduler if hosting on Fly.io and you want regular
            local copies.
          </p>
        </section>
      </div>
    </div>
  );
}
