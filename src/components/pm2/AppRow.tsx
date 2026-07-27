import { memo } from 'react';
import {
  ChevronRight, Info, Loader2, Play, RotateCcw, ScrollText, Square, Trash2,
} from 'lucide-react';
import { formatBytes } from '../../lib/utils';
import {
  type PM2App, type BootStatus,
  statusTone, TONE_DOT, TONE_TEXT, formatUptime, execMode, cpuTone, bootSummary,
} from '../../lib/pm2';

interface Props {
  app: PM2App;
  boot: BootStatus | null;
  logsOpen: boolean;
  busy: string;
  /** True when boot persistence is broken host-wide. In that case the page
   *  banner already says so once, and repeating it on every card turns a
   *  single machine-level fact into what looks like a per-process fault. */
  hostBootBroken: boolean;
  onLogs: () => void;
  onDetail: () => void;
  onAction: (action: 'start' | 'stop' | 'restart' | 'delete') => void;
}

/**
 * One application row.
 *
 * The old row put Details, Logs, Stop, Restart and Delete side by side as five
 * identical ghost icon buttons. Delete sat one pixel-hop from Restart at equal
 * visual weight — the same hazard worklog 1 called out on the Dashboard and
 * fixed there, still shipping here.
 *
 * Now: the lifecycle action you actually want (start/stop) is the visible
 * control, restart sits beside it, and destructive delete lives behind the
 * detail sheet rather than in the row. Metrics are mono + tabular so they stop
 * jittering as they tick.
 */
export const AppRow = memo(function AppRow({
  app, boot, logsOpen, busy, hostBootBroken, onLogs, onDetail, onAction,
}: Props) {
  const status = app.pm2_env.status;
  const tone = statusTone(status);
  const online = status === 'online';
  const cpu = app.monit?.cpu ?? 0;
  const mem = app.monit?.memory ?? 0;
  const cTone = cpuTone(cpu);
  const bootInfo = bootSummary(boot, app.name);
  // A process PM2 keeps reviving is failing, not healthy. High restart counts
  // were rendered in the same muted tone as every other metric, so a crash
  // loop looked identical to a stable service.
  const restarts = app.pm2_env.restart_time ?? 0;
  const looping = online && restarts >= 5;

  return (
    <div
      className={`group card overflow-hidden transition-colors ${
        tone === 'danger' ? 'border-danger/30' : 'hover:border-line-strong'
      }`}
    >
      <div className="flex items-stretch">
        {/* Status rail. Reads structurally at a glance without spending a
            saturated fill on the whole card. */}
        <span className={`w-[3px] shrink-0 ${TONE_DOT[tone]}`} aria-hidden="true" />

        <div className="flex-1 min-w-0 p-3 sm:p-3.5">
          {/* ── Identity ────────────────────────────────────────────── */}
          <div className="flex items-start gap-2">
            <button
              onClick={onDetail}
              className="min-w-0 flex-1 text-left group/name"
              aria-label={`Details for ${app.name}`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-title font-semibold text-ink truncate group-hover/name:text-accent transition-colors">
                  {app.name}
                </span>
                <ChevronRight
                  className="w-3.5 h-3.5 text-subtle shrink-0 opacity-0 group-hover/name:opacity-100 transition-opacity"
                  aria-hidden="true"
                />
              </span>
              <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className={`text-label font-medium uppercase ${TONE_TEXT[tone]}`}>
                  {status}
                </span>
                <span className="text-subtle text-label">·</span>
                <span className="text-label text-subtle">{execMode(app.pm2_env.exec_mode)}</span>
                <span className="text-subtle text-label">·</span>
                <span className="text-label text-subtle tabular-nums">id {app.pm_id}</span>
              </span>
              {/* Path belongs with the name it identifies. It sat bottom-right
                  of the card before, on a different baseline, reading as if it
                  labelled the Stop button. */}
              <span className="block text-label text-subtle font-mono truncate mt-0.5">
                {app.pm2_env.pm_exec_path}
              </span>
            </button>

            {/* ── Controls ──────────────────────────────────────────── */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onLogs}
                className={`btn-icon !w-8 !h-8 max-md:!w-10 max-md:!h-10 ${
                  logsOpen ? 'bg-accent/10 text-accent' : ''
                }`}
                aria-label={logsOpen ? `Hide logs for ${app.name}` : `Show logs for ${app.name}`}
                aria-pressed={logsOpen}
              >
                <ScrollText className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
              </button>

              <button
                onClick={() => onAction('restart')}
                disabled={!!busy || !online}
                className="btn-icon !w-8 !h-8 max-md:!w-10 max-md:!h-10"
                aria-label={`Restart ${app.name}`}
                title={online ? `Restart ${app.name}` : 'Not running — use Start'}
              >
                <RotateCcw
                  className={`w-4 h-4 ${busy === 'restart' ? 'animate-spin' : ''}`}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </button>

              {/* Stop is service-interrupting and should read that way. It
                  was `btn-quiet` — identical weight to a neutral control — so
                  the action that takes a live service down looked exactly as
                  consequential as toggling a log panel. Danger tone, but only
                  on the row that is actually running. */}
              <button
                onClick={() => onAction(online ? 'stop' : 'start')}
                disabled={!!busy}
                className={`btn btn-sm ${online ? 'btn-danger' : 'btn-primary'} max-md:!h-10`}
              >
                {busy === 'stop' || busy === 'start'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  : online
                    ? <Square className="w-3.5 h-3.5 fill-current" strokeWidth={0} aria-hidden="true" />
                    : <Play className="w-3.5 h-3.5 fill-current" strokeWidth={0} aria-hidden="true" />}
                <span>{online ? 'Stop' : 'Start'}</span>
              </button>
            </div>
          </div>

          {/* ── Metrics ─────────────────────────────────────────────
              Fixed-width columns. As inline key/value pairs the columns never
              lined up between rows — `MEM 0 B` vs `MEM 56.3 MB` shifted every
              following metric sideways, so uptime could not be compared down
              the list without reading each row individually. */}
          {/* Two columns on phones. Four 85px columns pushed `RESTARTS` into
              the card edge and made every value unreadable. */}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 max-w-md mt-2.5 text-meta">
            {/* A stopped process has no CPU share and no resident memory — the
                same class of meaningless-for-stopped metric as uptime. */}
            <Metric label="cpu" value={online ? `${cpu.toFixed(1)}%` : '—'} tone={online ? cTone : 'idle'} />
            <Metric label="mem" value={online ? formatBytes(mem) : '—'} />
            <Metric label="up" value={formatUptime(app.pm2_env.pm_uptime, status)} />
            <Metric
              label="restarts"
              value={String(restarts)}
              tone={restarts >= 15 ? 'danger' : restarts >= 5 ? 'warn' : 'idle'}
            />
          </dl>

          {/* Boot warning only when it is specific to THIS app — i.e. running
              but missing from the saved list. Host-level breakage is stated
              once in the page banner instead of on every card. */}
          {!bootInfo.onBoot && !hostBootBroken && (
            <p className="text-label text-amber-400/80 mt-1.5">{bootInfo.reason}</p>
          )}

          {looping && (
            <p className="text-label text-amber-400/90 mt-1.5">
              Restarted {restarts} times — check the logs, this app may be crash-looping.
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

const METRIC_TONE: Record<string, string> = {
  idle: 'text-muted',
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  danger: 'text-red-400',
};

function Metric({ label, value, tone = 'idle' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      {/* Label recedes, value leads. Both were the same size and near-same
          colour before, so `MEM` read as loudly as `56.3 MB`. */}
      <dt className="text-label text-subtle uppercase">{label}</dt>
      <dd className={`font-mono tabular-nums truncate ${METRIC_TONE[tone]}`}>{value}</dd>
    </div>
  );
}

export { Info, Trash2 };
