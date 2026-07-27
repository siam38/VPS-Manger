import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Boxes, ChevronRight, Plus, Power, RefreshCw } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useToast } from '../lib/toast';
import {
  type PM2App, type BootStatus, type LogLine,
  parseLogLevel, stripAnsi,
} from '../lib/pm2';
import { SummaryBar } from '../components/pm2/SummaryBar';
import { AppRow } from '../components/pm2/AppRow';
import { LogPanel } from '../components/pm2/LogPanel';
import { BootPanel } from '../components/pm2/BootPanel';
import { AppDetailSheet } from '../components/pm2/AppDetailSheet';
import { NewAppWizard } from '../components/pm2/NewAppWizard';

const MAX_LOG_LINES = 2000;

/**
 * PM2 section.
 *
 * Previously 1,460 lines holding four components, two competing notification
 * systems, a module-level log-id counter and a polling loop that swallowed
 * every error. The pieces now live in src/components/pm2/ and this file is
 * only orchestration: load, poll, stream logs, route to panels.
 */
export default function PM2Manager() {
  const toast = useToast();

  const [apps, setApps] = useState<PM2App[]>([]);
  const [boot, setBoot] = useState<BootStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [staleError, setStaleError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});

  const [logApp, setLogApp] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [detailApp, setDetailApp] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [showBoot, setShowBoot] = useState(false);

  const socketRef = useRef(getSocket());
  // Per-instance, not module scope. A module-level counter is shared across
  // every mount, so remounting the page collided ids and produced duplicate
  // React keys in the log list.
  const logSeq = useRef(0);

  /* ── Data ─────────────────────────────────────────────────────────── */

  const load = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setLoading(true);
    try {
      const data = await apiGet<PM2App[]>('/api/pm2/list');
      setApps(Array.isArray(data) ? data : []);
      setStaleError(null);
    } catch (e: any) {
      // The old version did `catch {}` here, so a dead panel looked exactly
      // like a healthy one with stale numbers.
      setStaleError(e?.message || 'Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBoot = useCallback(async () => {
    try {
      setBoot(await apiGet<BootStatus>('/api/pm2/boot-status'));
    } catch { /* boot info is supplementary; the list still works */ }
  }, []);

  useEffect(() => {
    load();
    loadBoot();
    const iv = setInterval(() => load({ quiet: true }), 5000);
    return () => clearInterval(iv);
  }, [load, loadBoot]);

  /* ── Log stream ───────────────────────────────────────────────────── */

  useEffect(() => {
    if (!logApp) return;
    const socket = socketRef.current;
    setLogs([]);
    logSeq.current = 0;

    socket.emit('pm2:logs:subscribe', { name: logApp });

    const onData = (data: { name: string; data: string; stream: string }) => {
      if (data.name !== logApp) return;
      const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
      const lines = data.data.split('\n').filter(Boolean).map<LogLine>(text => {
        const seq = ++logSeq.current;
        return {
          id: seq,
          seq,
          text,
          stream: data.stream === 'err' ? 'err' : 'out',
          timestamp: stamp,
          level: parseLogLevel(stripAnsi(text)),
        };
      });
      setLogs(prev => {
        const next = prev.concat(lines);
        return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
      });
    };

    socket.on('pm2:logs:data', onData);
    return () => {
      socket.emit('pm2:logs:unsubscribe', { name: logApp });
      socket.off('pm2:logs:data', onData);
    };
  }, [logApp]);

  /* ── Actions ──────────────────────────────────────────────────────── */

  const act = useCallback(async (
    name: string,
    action: 'start' | 'stop' | 'restart' | 'delete',
  ) => {
    if (action === 'delete') {
      const ok = await toast.confirm({
        title: `Delete ${name}?`,
        description: 'Removes the app from PM2. Files on disk are untouched.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(b => ({ ...b, [name]: action }));
    try {
      await apiPost(`/api/pm2/${action}`, { name_or_id: name });
      await load({ quiet: true });
      await loadBoot();
    } catch (e: any) {
      toast.error({ title: `Could not ${action} ${name}`, description: e.message });
    }
    setBusy(b => { const n = { ...b }; delete n[name]; return n; });
  }, [toast, load, loadBoot]);

  const saveList = useCallback(async () => {
    try {
      await apiPost('/api/pm2/save', {});
      toast.success({
        title: 'Process list saved',
        description: 'These apps will be restored at boot.',
      });
      await loadBoot();
    } catch (e: any) {
      toast.error({ title: 'Save failed', description: e.message });
    }
  }, [toast, loadBoot]);

  /* Apps running but absent from the saved dump — they vanish on reboot and
     nothing in the old UI said so. */
  const unsaved = boot?.dumpExists
    ? apps.filter(a => !boot.savedApps.includes(a.name)).map(a => a.name)
    : [];
  const bootRisk = !!boot && (!boot.daemonAtBoot || !boot.dumpExists || unsaved.length > 0);

  return (
    <div className="h-full flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 sm:px-4 h-14 border-b border-line shrink-0">
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-semibold text-ink">Applications</h1>
          <p className="text-label text-subtle">
            {loading && !apps.length
              ? 'Loading…'
              : `${apps.length} managed by PM2`}
          </p>
        </div>

        {/* Boot control carries its own state. As a bare icon+label there was
           no way to know whether persistence was on without opening the
           panel, so people clicked it just to find out. */}
        <button
          onClick={() => setShowBoot(true)}
          className={`btn btn-sm btn-quiet max-md:!h-10 ${bootRisk ? '!text-amber-400' : ''}`}
          title={
            bootRisk
              ? 'Apps are not fully configured to restart after a reboot'
              : 'Apps will restart after a reboot'
          }
        >
          <Power className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
          <span className="max-sm:sr-only">Boot</span>
          {boot && !bootRisk && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
          )}
          {bootRisk && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" aria-hidden="true" />
          )}
        </button>

        <button
          onClick={() => { load(); loadBoot(); }}
          className="btn-icon max-md:!w-10 max-md:!h-10"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.5} aria-hidden="true" />
        </button>

        {apps.length > 0 && (
          <button onClick={() => setShowWizard(true)} className="btn btn-sm btn-primary max-md:!h-10">
            <Plus className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
            <span className="max-sm:sr-only">New app</span>
          </button>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-auto p-3 sm:p-4 space-y-3"
        // Keep the last row clear of the docked log panel.
        style={{ paddingBottom: logApp ? 'calc(55vh + 1rem)' : undefined }}
      >
        {staleError && (
          <div className="flex items-start gap-2.5 rounded-card border border-danger/25 bg-danger/5 p-3">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" strokeWidth={1.5} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-body font-medium text-danger">Not receiving updates</p>
              <p className="text-meta text-muted mt-0.5">
                {staleError}. The list below may be out of date.
              </p>
            </div>
            <button onClick={() => load()} className="btn btn-sm btn-quiet ml-auto shrink-0">Retry</button>
          </div>
        )}

        {/* Boot risk banner. The single most consequential thing the old page
            never told you: these apps are not coming back after a reboot. */}
        {bootRisk && apps.length > 0 && (
          <button
            onClick={() => setShowBoot(true)}
            className="group w-full flex items-start gap-2.5 rounded-card border border-amber-400/25 bg-amber-400/5 p-3 text-left hover:border-amber-400/40 hover:bg-amber-400/[0.08] transition-colors"
          >
            <Power className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" strokeWidth={1.5} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-amber-300">
                {!boot?.daemonAtBoot
                  ? 'Apps will not restart after a reboot'
                  : `${unsaved.length} app${unsaved.length === 1 ? '' : 's'} not saved for boot`}
              </span>
              <span className="block text-meta text-muted mt-0.5">
                {!boot?.daemonAtBoot
                  ? 'PM2 is not configured to start when this machine boots.'
                  : unsaved.slice(0, 4).join(', ') + (unsaved.length > 4 ? '…' : '')}
              </span>
            </span>
            {/* The banner is the only place that tells you apps will not
                survive a reboot, so it has to carry a visible way out. As a
                muted sentence ending in a full stop it read as a dead
                instruction with nowhere to go. */}
            <span className="btn btn-sm btn-quiet !text-amber-300 shrink-0 pointer-events-none group-hover:bg-amber-400/10">
              Review setup
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
            </span>
          </button>
        )}

        {apps.length > 0 && <SummaryBar apps={apps} />}

        {!loading && apps.length === 0 && !staleError && (
          <div className="empty">
            <Boxes className="w-9 h-9 text-muted mb-1" strokeWidth={1.25} aria-hidden="true" />
            <p className="empty-title">No applications yet</p>
            <p className="empty-sub">
              PM2 keeps processes alive, restarts them when they crash, and can bring them
              back after a reboot. Add one, or restore a previously saved list.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              <button onClick={() => setShowWizard(true)} className="btn btn-primary">
                <Plus className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" /> Add application
              </button>
              {boot?.dumpExists && (
                <button onClick={() => setShowBoot(true)} className="btn btn-quiet">
                  <Power className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" /> Restore saved
                </button>
              )}
            </div>
          </div>
        )}

        {apps.map(app => (
          <AppRow
            key={app.pm_id}
            app={app}
            boot={boot}
            busy={busy[app.name] || ''}
            hostBootBroken={!boot?.daemonAtBoot}
            logsOpen={logApp === app.name}
            onLogs={() => setLogApp(cur => (cur === app.name ? null : app.name))}
            onDetail={() => setDetailApp(app.name)}
            onAction={a => act(app.name, a)}
          />
        ))}
      </div>

      {/* ── Overlays ───────────────────────────────────────────────── */}
      {logApp && (
        <LogPanel
          appName={logApp}
          lines={logs}
          onClear={() => setLogs([])}
          onClose={() => setLogApp(null)}
        />
      )}

      {showBoot && (
        <BootPanel
          boot={boot}
          apps={apps.map(a => a.name)}
          onClose={() => setShowBoot(false)}
          onChanged={loadBoot}
        />
      )}

      {detailApp && (
        <AppDetailSheet
          appName={detailApp}
          boot={boot}
          onClose={() => setDetailApp(null)}
          onAction={() => { load({ quiet: true }); loadBoot(); }}
          onSaveBoot={saveList}
        />
      )}

      {showWizard && (
        <NewAppWizard
          onClose={() => setShowWizard(false)}
          onCreated={() => { load(); loadBoot(); }}
        />
      )}
    </div>
  );
}
