import { memo } from 'react';
import {
  ChevronRight, Info, Play, RotateCcw, ScrollText, Square, Trash2,
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
  app, boot, logsOpen, busy, onLogs, onDetail, onAction,
}: Props) {
  const status = app.pm2_env.status;
  const tone = statusTone(status);
  const online = status === 'online';
  const cpu = app.monit?.cpu ?? 0;
  const mem = app.monit?.memory ?? 0;
  const cTone = cpuTone(cpu);
  const bootInfo = bootSummary(boot, app.name);

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
                <span className="text-body font-semibold text-ink truncate group-hover/name:text-accent transition-colors">
                  {app.name}
                </span>
                <ChevronRight
                  className="w-3.5 h-3.5 text-subtle shrink-0 opacity-0 group-hover/name:opacity-100 transition-opacity"
                  aria-hidden="true"
                />
              </span>
              <span className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className={`text-label font-medium uppercase ${TONE_TEXT[tone]}`}>
                  {status}
                </span>
                <span className="text-subtle text-label">·</span>
                <span className="text-label text-subtle">{execMode(app.pm2_env.exec_mode)}</span>
                <span className="text-subtle text-label">·</span>
                <span className="text-label text-subtle font-mono tabular-nums">id {app.pm_id}</span>
                {/* Boot state, stated plainly. This is the question people
                    actually have and it was invisible before. */}
                {!bootInfo.onBoot && (
                  <>
                    <span className="text-subtle text-label">·</span>
                    <span className="text-label text-amber-400/80">not on boot</span>
                  </>
                )}
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
                disabled={!!busy}
                className="btn-icon !w-8 !h-8 max-md:!w-10 max-md:!h-10"
                aria-label={`Restart ${app.name}`}
              >
                <RotateCcw
                  className={`w-4 h-4 ${busy === 'restart' ? 'animate-spin' : ''}`}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </button>

              {/* The primary lifecycle action gets a real filled/quiet button,
                  not a fifth identical glyph. */}
              <button
                onClick={() => onAction(online ? 'stop' : 'start')}
                disabled={!!busy}
                className={`btn btn-sm ${online ? 'btn-quiet' : 'btn-primary'} max-md:!h-10`}
              >
                {online
                  ? <Square className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
                  : <Play className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />}
                <span className="max-sm:sr-only">{online ? 'Stop' : 'Start'}</span>
              </button>
            </div>
          </div>

          {/* ── Metrics ─────────────────────────────────────────────
              Mono + tabular figures. Non-tabular digits on live-updating
              numbers make the entire row shift on every poll. */}
          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-meta">
            <Metric label="cpu" value={`${cpu.toFixed(1)}%`} tone={cTone} />
            <Metric label="mem" value={formatBytes(mem)} />
            <Metric label="up" value={formatUptime(app.pm2_env.pm_uptime)} />
            <Metric
              label="restarts"
              value={String(app.pm2_env.restart_time ?? 0)}
              tone={(app.pm2_env.restart_time ?? 0) > 10 ? 'warn' : 'idle'}
            />
            <dd className="hidden lg:block text-subtle font-mono truncate max-w-[280px] ml-auto">
              {app.pm2_env.pm_exec_path}
            </dd>
          </dl>
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
    <div className="flex items-baseline gap-1.5">
      <dt className="text-label text-subtle uppercase">{label}</dt>
      <dd className={`font-mono tabular-nums ${METRIC_TONE[tone]}`}>{value}</dd>
    </div>
  );
}

export { Info, Trash2 };
