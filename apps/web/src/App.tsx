import { useEffect, useMemo, useState } from 'react';
import { FlowGrid } from './components/FlowGrid';
import { ForecastHelper } from './components/ForecastHelper';
import { StockOnHand } from './components/StockOnHand';
import { ForecastedWeights } from './components/ForecastedWeights';
import { Transactions } from './components/Transactions';
import { Feeding } from './components/Feeding';
import { Budgets } from './components/Budgets';
import { Settings } from './components/Settings';
import { Login } from './components/Login';
import {
  fetchAuthStatus,
  fetchFlowGrid,
  fetchStatus,
  logout,
  type ApiStatus,
  type AuthStatus,
  type FlowGridData,
  type MonthKey,
} from './lib/api';
import { cn } from './lib/utils';

type View = 'flow' | 'stock' | 'forecasted' | 'transactions' | 'feeding' | 'budgets' | 'settings';

const VIEWS: { id: View; label: string; short?: string }[] = [
  { id: 'flow', label: 'Flow' },
  { id: 'stock', label: 'Stock on Hand', short: 'Stock' },
  { id: 'forecasted', label: 'Forecasted Weights', short: 'Weights' },
  { id: 'transactions', label: 'Transactions', short: 'Txns' },
  { id: 'feeding', label: 'Feeding' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'settings', label: 'Settings' },
];

function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<View>('flow');
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [grid, setGrid] = useState<FlowGridData | null>(null);
  const [gridError, setGridError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = () => {
    fetchFlowGrid()
      .then((d) => {
        setGrid(d);
        setGridError(null);
        setRefreshKey((c) => c + 1);
      })
      .catch((e: Error) => setGridError(e.message));
  };

  // Check auth on boot; only fetch app data once authenticated.
  useEffect(() => {
    fetchAuthStatus()
      .then(setAuth)
      .catch(() => setAuth({ authenticated: false, auth_enabled: true }));
  }, []);

  useEffect(() => {
    if (auth?.authenticated) {
      fetchStatus().then(setStatus).catch(() => setStatus(null));
      refetch();
    }
  }, [auth?.authenticated]);

  const defaultTarget = useMemo<MonthKey | null>(() => {
    if (!grid || !grid.current_month) return null;
    const idx = grid.months.indexOf(grid.current_month);
    if (idx < 0) return grid.months[grid.months.length - 1] ?? null;
    return grid.months[Math.min(idx + 3, grid.months.length - 1)] ?? null;
  }, [grid]);

  if (auth === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!auth.authenticated) {
    return <Login onLoggedIn={() => setAuth({ ...auth, authenticated: true, username: 'logged-in' })} />;
  }

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      setAuth({ authenticated: false, auth_enabled: auth.auth_enabled });
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-[1800px] px-3 py-2 sm:px-6 sm:py-3 transition-layout">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">RanchApp</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Stock_Flow_MASTER replacement — local-first, forecast-aware.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {status && (
                <div className="hidden flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:flex sm:text-xs">
                  <span>
                    <span className="font-mono text-primary">
                      {status.counts.animals.toLocaleString()}
                    </span>{' '}
                    animals
                  </span>
                  <span>
                    <span className="font-mono text-primary">
                      {status.counts.transactions.toLocaleString()}
                    </span>{' '}
                    txns
                  </span>
                  <span>
                    <span className="font-mono text-primary">{status.counts.paddocks}</span> paddocks
                  </span>
                  <span>
                    <span className="font-mono text-primary">{status.counts.mobs}</span> mobs
                  </span>
                </div>
              )}
              {auth.auth_enabled && (
                <button
                  onClick={handleLogout}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  title="Sign out"
                >
                  Sign out
                </button>
              )}
            </div>
          </div>

          <nav className="scroll-touch -mx-3 mt-2 flex overflow-x-auto sm:mx-0 sm:mt-3 sm:flex-wrap sm:overflow-visible">
            <div className="flex gap-1 px-3 pb-1 sm:px-0">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className={cn(
                    'shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:py-1.5',
                    'min-h-[40px] sm:min-h-0',
                    view === v.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <span className="sm:hidden">{v.short ?? v.label}</span>
                  <span className="hidden sm:inline">{v.label}</span>
                </button>
              ))}
            </div>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] space-y-4 px-3 py-4 sm:px-6 sm:py-6 transition-layout">
        {gridError && view === 'flow' && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
            <strong>API offline:</strong> {gridError}
          </div>
        )}

        {view === 'flow' && (
          <>
            {!grid && !gridError && (
              <div className="text-sm text-muted-foreground">Loading flow grid…</div>
            )}
            {grid && (
              <>
                <FlowGrid data={grid} onChanged={refetch} />
                <ForecastHelper
                  months={grid.months}
                  defaultTarget={defaultTarget}
                  refreshKey={refreshKey}
                />
              </>
            )}
          </>
        )}

        {view === 'stock' && <StockOnHand />}
        {view === 'forecasted' && <ForecastedWeights />}
        {view === 'transactions' && <Transactions />}
        {view === 'feeding' && <Feeding />}
        {view === 'budgets' && <Budgets />}
        {view === 'settings' && <Settings onImported={refetch} />}
      </main>
    </div>
  );
}

export default App;
