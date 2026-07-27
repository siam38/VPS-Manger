import { Activity, AlertTriangle, Cpu, MemoryStick, Square } from 'lucide-react';
import { formatBytes } from '../../lib/utils';
import type { PM2App } from '../../lib/pm2';
import { cpuTone } from '../../lib/pm2';

/**
 * Fleet summary.
 *
 * The previous version painted six tiles in six hues — cyan CPU, purple
 * memory, green online, red errored, amber stopped — on a perfectly healthy
 * system. When every tile is coloured, colour carries no information and
 * there is nothing left to escalate with when something genuinely breaks.
 *
 * Here the default state is neutral. Colour appears only when a number means
 * something: apps that are errored, or CPU past its threshold.
 */
export function SummaryBar({ apps }: { apps: PM2App[] }) {
  const online = apps.filter(a => a.pm2_env.status === 'online').length;
  const stopped = apps.filter(a => a.pm2_env.status === 'stopped').length;
  const errored = apps.filter(a => a.pm2_env.status === 'errored').length;
  const totalCpu = apps.reduce((s, a) => s + (a.monit?.cpu || 0), 0);
  const totalMem = apps.reduce((s, a) => s + (a.monit?.memory || 0), 0);

  const cpuT = cpuTone(totalCpu);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Stat
        icon={Activity}
        label="Running"
        value={`${online}`}
        sub={`of ${apps.length}`}
        // Only dims to a warning if something isn't running that should be.
        tone={online < apps.length ? 'warn' : 'idle'}
      />
      <Stat
        icon={AlertTriangle}
        label="Errored"
        value={`${errored}`}
        sub={stopped ? `${stopped} stopped` : 'none stopped'}
        tone={errored > 0 ? 'danger' : 'idle'}
      />
      <Stat
        icon={Cpu}
        label="CPU"
        value={`${totalCpu.toFixed(1)}%`}
        sub="all processes"
        tone={cpuT}
      />
      <Stat
        icon={MemoryStick}
        label="Memory"
        value={formatBytes(totalMem)}
        sub="resident"
        tone="idle"
      />
    </div>
  );
}

const TONE_VALUE: Record<string, string> = {
  idle: 'text-ink',
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  danger: 'text-red-400',
};

const TONE_ICON: Record<string, string> = {
  idle: 'text-muted',
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  danger: 'text-red-400',
};

function Stat({
  icon: Icon, label, value, sub, tone = 'idle',
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="card px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${TONE_ICON[tone]}`} strokeWidth={1.5} aria-hidden="true" />
        <span className="eyebrow">{label}</span>
      </div>
      {/* Tabular figures: these numbers tick every few seconds, and
          proportional digits make the whole tile jitter as they change. */}
      <div className={`text-title font-semibold font-mono tabular-nums ${TONE_VALUE[tone]}`}>
        {value}
      </div>
      <div className="text-label text-subtle mt-0.5">{sub}</div>
    </div>
  );
}

export { Square };
