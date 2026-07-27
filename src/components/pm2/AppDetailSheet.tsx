import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown, ChevronRight, Eraser, Hash, Loader2, Play, Power,
  RefreshCw, RotateCcw, Square, Trash2, X, Zap,
} from 'lucide-react';
import { apiGet, apiPost } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { formatBytes } from '../../lib/utils';
import {
  type AppDetail, type BootStatus,
  statusTone, TONE_DOT, TONE_TEXT, formatUptime, execMode, bootSummary,
} from '../../lib/pm2';

interface Props {
  appName: string;
  boot: BootStatus | null;
  onClose: () => void;
  onAction: () => void;
  onSaveBoot: () => Promise<void>;
}

/**
 * Application detail sheet.
 *
 * Bottom sheet on mobile, centred modal on desktop — the old version was a
 * centred modal at every width, so on a phone it floated in the middle of the
 * screen with margins on all four sides and its own inner scrollbar.
 *
 * The action grid previously used six different colours (blue restart, cyan
 * reload, purple flush, amber stop, green start, red delete) at identical
 * weight. Six hues for six verbs is decoration, and it put Delete at the same
 * visual priority as Reset Count. Now: one row of ordinary actions, and
 * destructive actions separated below a divider.
 */
export function AppDetailSheet({ appName, boot, onClose, onAction, onSaveBoot }: Props) {
  const toast = useToast();
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEnv, setShowEnv] = useState(false);
  const [scaleInput, setScaleInput] = useState('');
  const [busy, setBusy] = useState('');
  const [smartRestart, setSmartRestart] = useState(false);
  const [smartBusy, setSmartBusy] = useState(false);

  const loadDetail = useCallback(async () => {
    try {
      const data = await apiGet<AppDetail>(`/api/pm2/app-detail/${encodeURIComponent(appName)}`);
      setDetail(data);
      setSmartRestart(
        data.env_vars?.PANEL_SMART_RESTART === 'true' || data.env_vars?.PANEL_SMART_RESTART === '1'
      );
    } catch (e: any) {
      toast.error({ title: 'Could not load app details', description: e.message });
    }
    setLoading(false);
  }, [appName, toast]);

  useEffect(() => { loadDetail(); /* eslint-disable-next-line */ }, [appName]);

  const run = async (action: string, body?: any) => {
    setBusy(action);
    try {
      await apiPost(`/api/pm2/${action}`, body || { name_or_id: appName });
      onAction();
      await loadDetail();
    } catch (e: any) {
      toast.error({ title: `Could not ${action} ${appName}`, description: e.message });
    }
    setBusy('');
  };

  const envEntries = detail
    ? Object.entries(detail.env_vars || {}).filter(([k]) =>
        !k.startsWith('PM2_') && !k.startsWith('pm2_') && k !== 'NODE_APP_INSTANCE' &&
        k !== 'vizion_running' && k !== 'km_link' && !k.startsWith('unique_id'))
    : [];

  const tone = statusTone(detail?.status || '');
  const online = detail?.status === 'online';
  const bootInfo = bootSummary(boot, appName);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4">
      <div className="bg-canvas border border-line w-full sm:max-w-lg max-h-[92vh] sm:max-h-[85vh]
                      rounded-t-modal sm:rounded-modal overflow-hidden flex flex-col shadow-2xl animate-slide-up">

        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 h-14 border-b border-line shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[tone]}`} aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="text-body font-semibold text-ink truncate">{appName}</h3>
              <p className="text-label text-subtle">
                <span className={TONE_TEXT[tone]}>{detail?.status || 'loading…'}</span>
                {detail && <> · id {detail.pm_id} · {execMode(detail.exec_mode)}</>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon !w-9 !h-9" aria-label="Close details">
            <X className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-14">
            <Loader2 className="w-5 h-5 text-accent animate-spin" aria-hidden="true" />
          </div>
        ) : detail ? (
          <div className="flex-1 overflow-auto p-4 sm:p-5 space-y-4">

            {/* Live metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Tile label="CPU" value={`${detail.monit?.cpu ?? 0}%`} />
              <Tile label="Memory" value={formatBytes(detail.monit?.memory || 0)} />
              <Tile label="Uptime" value={formatUptime(detail.pm_uptime)} />
              <Tile label="Restarts" value={String(detail.restart_time)} />
            </div>

            {/* Boot state — the question the old UI never answered per app. */}
            <div className="rounded-card border border-line bg-surface p-3.5">
              <div className="flex items-start gap-2.5">
                <Power
                  className={`w-4 h-4 shrink-0 mt-0.5 ${bootInfo.onBoot ? 'text-emerald-400' : 'text-amber-400'}`}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-ink">
                    {bootInfo.onBoot ? 'Starts on boot' : 'Does not start on boot'}
                  </p>
                  <p className="text-meta text-muted mt-0.5">{bootInfo.reason}</p>
                </div>
                {!bootInfo.onBoot && boot?.daemonAtBoot && (
                  <button
                    onClick={async () => { setBusy('save'); await onSaveBoot(); setBusy(''); }}
                    disabled={!!busy}
                    className="btn btn-sm btn-primary shrink-0"
                  >
                    {busy === 'save'
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      : null}
                    Save
                  </button>
                )}
              </div>
              {/* autorestart is about crashes, not boot. Naming them apart
                  stops the two being confused. */}
              <p className="text-label text-subtle mt-2 pt-2 border-t border-line/70">
                Crash recovery (autorestart): {detail.autorestart ? 'on' : 'off'} — restarts the app if it
                exits unexpectedly. Separate from boot.
              </p>
            </div>

            {/* Paths */}
            <div>
              <p className="eyebrow mb-1.5">Paths</p>
              <dl className="rounded-card border border-line bg-surface divide-y divide-line/70 text-meta">
                <PathRow k="Script" v={detail.pm_exec_path} />
                <PathRow k="CWD" v={detail.pm_cwd} />
                <PathRow k="Out" v={detail.pm_out_log_path} />
                <PathRow k="Err" v={detail.pm_err_log_path} />
              </dl>
            </div>

            {/* Smart restart */}
            <label className="rounded-card border border-line bg-surface p-3.5 flex items-start gap-3 cursor-pointer">
              <Zap className="w-4 h-4 text-muted shrink-0 mt-0.5" strokeWidth={1.5} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="text-body font-medium text-ink block">Smart restart</span>
                <span className="text-meta text-muted block mt-0.5">
                  Restart when files change via File Manager or Git pull. Ignores writes the app makes itself,
                  so databases and logs cannot trigger a restart loop.
                </span>
              </span>
              <span className="shrink-0 flex items-center gap-2">
                {smartBusy && <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" aria-hidden="true" />}
                <input
                  type="checkbox"
                  checked={smartRestart}
                  disabled={smartBusy}
                  onChange={async e => {
                    const enabled = e.target.checked;
                    setSmartBusy(true);
                    try {
                      await apiPost('/api/pm2/smart-restart', { name: appName, enabled });
                      setSmartRestart(enabled);
                    } catch (err: any) {
                      toast.error({ title: 'Could not change smart restart', description: err.message });
                    }
                    setSmartBusy(false);
                  }}
                  className="accent-accent w-4 h-4"
                />
              </span>
            </label>

            {/* Scale, cluster only */}
            {detail.exec_mode?.includes('cluster') && (
              <div>
                <label htmlFor="scale" className="eyebrow block mb-1.5">Scale instances</label>
                <div className="flex gap-2">
                  <input
                    id="scale"
                    value={scaleInput}
                    onChange={e => setScaleInput(e.target.value)}
                    placeholder={`Currently ${detail.instances || 1}`}
                    className="field flex-1"
                  />
                  <button
                    onClick={() => scaleInput && run('scale', { name: appName, instances: scaleInput })}
                    disabled={!scaleInput || !!busy}
                    className="btn btn-quiet"
                  >
                    Scale
                  </button>
                </div>
              </div>
            )}

            {/* Environment */}
            {envEntries.length > 0 && (
              <div>
                <button
                  onClick={() => setShowEnv(v => !v)}
                  className="eyebrow flex items-center gap-1.5 hover:text-ink transition-colors"
                  aria-expanded={showEnv}
                >
                  {showEnv
                    ? <ChevronDown className="w-3 h-3" aria-hidden="true" />
                    : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                  Environment ({envEntries.length})
                </button>
                {showEnv && (
                  <div className="mt-1.5 rounded-card border border-line bg-surface max-h-48 overflow-auto">
                    {envEntries.map(([k, v]) => (
                      <div key={k} className="flex gap-2 px-3 py-1.5 text-meta font-mono border-b border-line/40 last:border-0">
                        <span className="text-accent shrink-0">{k}</span>
                        <span className="text-muted truncate">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Actions. Ordinary verbs first, destructive separated. */}
            <div>
              <p className="eyebrow mb-1.5">Actions</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Act label={online ? 'Stop' : 'Start'} icon={online ? Square : Play}
                     busy={busy} action={online ? 'stop' : 'start'} onRun={run} />
                <Act label="Restart" icon={RotateCcw} busy={busy} action="restart" onRun={run} />
                <Act label="Reload" icon={RefreshCw} busy={busy} action="reload" onRun={run} />
                <Act label="Flush logs" icon={Eraser} busy={busy} action="flush" onRun={run} />
              </div>

              <div className="flex flex-wrap gap-2 mt-2 pt-3 border-t border-line">
                <button
                  onClick={() => run('reset')}
                  disabled={!!busy}
                  className="btn btn-sm btn-quiet"
                >
                  <Hash className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
                  Reset restart count
                </button>
                <button
                  onClick={async () => {
                    const ok = await toast.confirm({
                      title: `Delete ${appName}?`,
                      description: 'Removes the app from PM2. Files on disk are untouched.',
                      confirmLabel: 'Delete',
                      danger: true,
                    });
                    if (!ok) return;
                    await run('delete', { name_or_id: appName });
                    onClose();
                  }}
                  disabled={!!busy}
                  className="btn btn-sm btn-danger ml-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty">
            <p className="empty-title">App not found</p>
            <p className="empty-sub">It may have been deleted since this list was loaded.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-2">
      <p className="eyebrow">{label}</p>
      <p className="text-body font-semibold text-ink font-mono tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function PathRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 px-3 py-2">
      <dt className="text-subtle shrink-0 w-12">{k}</dt>
      <dd className="text-muted font-mono break-all">{v || '—'}</dd>
    </div>
  );
}

function Act({
  label, icon: Icon, busy, action, onRun,
}: {
  label: string; icon: typeof Play; busy: string; action: string;
  onRun: (a: string) => void;
}) {
  return (
    <button onClick={() => onRun(action)} disabled={!!busy} className="btn btn-sm btn-quiet !justify-start">
      {busy === action
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        : <Icon className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />}
      {label}
    </button>
  );
}
