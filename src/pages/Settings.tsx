import { useEffect, useState } from 'react';
import { RefreshCw, Download, CheckCircle2, WifiOff, AlertTriangle, RotateCcw } from 'lucide-react';
import {
  checkForUpdate, saveUpdateConfig, resetDismissals, reasonLabel, formatChecked,
  applyUpdate, fetchUpdateStatus,
  type UpdateCheck, type UpdateConfig, type UpdateStatus,
} from '../lib/update';
import { useToast } from '../lib/toast';
import UpdateProgress from '../components/UpdateProgress';

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
  const [updating, setUpdating] = useState(false);
  const [lastRun, setLastRun] = useState<UpdateStatus | null>(null);

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

  // An update may already be running: started from another tab, or still
  // finishing from before this page was opened.
  useEffect(() => {
    fetchUpdateStatus().then(s => {
      if (!s) return;
      if (s.running) setUpdating(true);
      else if (s.finishedAt) setLastRun(s);
    });
  }, []);

  const startUpdate = async () => {
    const ok = await toast.confirm({
      title: `Update to v${check?.latestVersion}?`,
      description: 'The panel will restart. Terminal sessions end; PM2 apps keep running. If the new version fails to start, the previous one is restored automatically.',
      confirmLabel: 'Update now',
    });
    if (!ok) return;
    try {
      await applyUpdate();
      setUpdating(true);
    } catch (e: any) {
      toast.error(e.message || 'Could not start the update');
    }
  };

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
        <p className="text-meta text-muted mt-0.5">Panel updates, channel, and check frequency.</p>
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
          {/* While an update runs, progress replaces the controls entirely —
              nothing else on this card is actionable until it finishes. */}
          {updating ? (
            <UpdateProgress onDone={s => { setUpdating(false); setLastRun(s); }} />
          ) : (
            <>
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
            <div className="space-y-3">
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
              <button onClick={startUpdate} className="btn btn-primary gap-1.5">
                <Download className="w-4 h-4" aria-hidden="true" />
                Update to v{check?.latestVersion}
              </button>
            </div>
          )}

          {lastRun && !lastRun.running && (
            <div className={`flex items-start gap-2 text-meta rounded-control px-3 py-2.5 border
              ${lastRun.ok ? 'text-success bg-success/5 border-success/25' : 'text-danger bg-danger/5 border-danger/25'}`}>
              {lastRun.ok
                ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />}
              <span>{lastRun.message}</span>
            </div>
          )}

          <div className="border-t border-line pt-4 space-y-3">
            <label className="setting-row cursor-pointer">
              <span className="min-w-0">
                <span className="block text-body text-ink">Check for updates automatically</span>
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
            </>
          )}
        </div>
      </section>
    </div>
  );
}
