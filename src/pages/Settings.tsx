import { useEffect, useState } from 'react';
import { RefreshCw, Download, CheckCircle2, WifiOff, AlertTriangle, RotateCcw } from 'lucide-react';
import {
  checkForUpdate, saveUpdateConfig, resetDismissals, reasonLabel, formatChecked,
  type UpdateCheck, type UpdateConfig,
} from '../lib/update';
import { useToast } from '../lib/toast';

/**
 * Settings. Today it holds the update system; it exists as its own route
 * because "check for updates" must never be reachable *only* through a popup
 * you have already dismissed.
 */
export default function Settings() {
  const toast = useToast();
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [config, setConfig] = useState<UpdateConfig | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (force = false) => {
    setBusy(true);
    try {
      const r = await checkForUpdate(force);
      setCheck(r);
      if (r.config) setConfig(r.config);
      if (force) {
        if (r.updateAvailable) toast.info(`Update available: v${r.latestVersion}`);
        else toast.success(reasonLabel(r));
      }
    } catch (e: any) {
      toast.error(e.message || 'Update check failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(false); }, []);

  const patch = async (p: Partial<UpdateConfig>) => {
    try { setConfig(await saveUpdateConfig(p)); }
    catch (e: any) { toast.error(e.message || 'Could not save'); }
  };

  const clearDismissals = async () => {
    try {
      setConfig(await resetDismissals());
      toast.success('Reminders reset');
      load(false);
    } catch (e: any) { toast.error(e.message || 'Failed'); }
  };

  const available = check?.updateAvailable;
  const offline = check && !check.reachable;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-ink">Settings</h1>
        <p className="text-meta text-muted mt-0.5">Panel updates and preferences.</p>
      </header>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Updates</h2>
          <button
            onClick={() => load(true)}
            disabled={busy}
            className="btn btn-quiet btn-sm gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
            Check now
          </button>
        </div>

        <div className="card-body space-y-4">
          {/* Status reads as a sentence, not a status code. */}
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0">
              {available
                ? <Download className="w-5 h-5 text-accent" aria-hidden="true" />
                : offline
                  ? <WifiOff className="w-5 h-5 text-warning" aria-hidden="true" />
                  : <CheckCircle2 className="w-5 h-5 text-success" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <div className="text-body text-ink">
                {available
                  ? `Version ${check?.latestVersion} is available`
                  : check ? reasonLabel(check) : 'Checking…'}
              </div>
              <div className="text-label text-muted mt-0.5 font-mono tabular">
                installed v{check?.currentVersion ?? '—'} · checked {formatChecked(check?.checkedAt)}
                {check?.source ? ` · via ${check.source}` : ''}
              </div>
            </div>
          </div>

          {available && (
            <div className="text-meta text-muted">
              {check?.commitCount ? `${check.commitCount} commit${check.commitCount === 1 ? '' : 's'} since your version.` : null}
              {check?.releaseUrl && (
                <>
                  {' '}
                  <a href={check.releaseUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    View changes
                  </a>
                </>
              )}
            </div>
          )}

          <div className="border-t border-line pt-4 space-y-3">
            <label className="setting-row cursor-pointer">
              <span className="min-w-0">
                <span className="block text-body text-ink">Check automatically</span>
                <span className="block text-label text-muted">Look for new versions in the background.</span>
              </span>
              <input
                type="checkbox"
                checked={config?.enabled ?? true}
                onChange={e => patch({ enabled: e.target.checked })}
                className="shrink-0 w-4 h-4 accent-current"
              />
            </label>

            <label className="setting-row">
              <span className="min-w-0">
                <span className="block text-body text-ink">Check every</span>
                <span className="block text-label text-muted">Hours between background checks.</span>
              </span>
              <select
                value={config?.checkIntervalHours ?? 6}
                onChange={e => patch({ checkIntervalHours: Number(e.target.value) })}
                className="field w-28 shrink-0"
              >
                {[1, 6, 12, 24, 168].map(h => (
                  <option key={h} value={h}>{h === 168 ? 'week' : `${h}h`}</option>
                ))}
              </select>
            </label>

            <label className="setting-row">
              <span className="min-w-0">
                <span className="block text-body text-ink">Channel</span>
                <span className="block text-label text-muted">Beta includes pre-releases.</span>
              </span>
              <select
                value={config?.channel ?? 'stable'}
                onChange={e => patch({ channel: e.target.value as 'stable' | 'beta' })}
                className="field w-28 shrink-0"
              >
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
              </select>
            </label>

            {(config?.snoozedUntil || config?.skippedVersion) && (
              <div className="setting-row">
                <span className="min-w-0">
                  <span className="block text-body text-ink">Reminders paused</span>
                  <span className="block text-label text-muted">
                    {config.skippedVersion && `Skipping v${config.skippedVersion}. `}
                    {config.snoozedUntil && `Snoozed until ${new Date(config.snoozedUntil).toLocaleString()}.`}
                  </span>
                </span>
                <button onClick={clearDismissals} className="btn btn-quiet btn-sm gap-1.5 shrink-0">
                  <RotateCcw className="w-4 h-4" aria-hidden="true" />
                  Reset
                </button>
              </div>
            )}
          </div>

          {/* Applying updates is deliberately not wired yet — saying so beats a
              button that silently does nothing. */}
          <div className="flex items-start gap-2 text-meta text-muted bg-raised border border-line
                          rounded-control px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Detection only for now. Installing updates from the panel is not enabled yet —
              update manually until it is.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
