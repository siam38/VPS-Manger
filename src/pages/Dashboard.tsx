import React, { useEffect, useState, useRef } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { getSocket } from '../lib/socket';
import { formatBytes, formatUptime } from '../lib/utils';
import {
  Cpu, MemoryStick, HardDrive, Clock, X, RotateCcw, Trash2,
  RefreshCw, ScrollText, Wifi, ArrowDown, ArrowUp,
} from 'lucide-react';

interface Stats {
  cpu: number;
  memory: { total: number; used: number; free: number; percentage: number };
  disk: { total: number; used: number; available: number; percentage: number } | null;
  network: { rx: number; tx: number };
  loadAvg: number[];
  timestamp: number;
}

interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  uptime: number;
  cpuCount: number;
  cpuModel: string;
  memory: { total: number; free: number; used: number };
  disk: { total: number; used: number; available: number; percentage: number } | null;
  ip: string;
  network: { rx: number; tx: number };
}

const HISTORY_SIZE = 60;
const WINDOW_LABEL = 'last 2 min';

/** Thresholds are the only thing allowed to introduce colour. */
function level(pct: number): 'ok' | 'warn' | 'bad' {
  if (pct >= 90) return 'bad';
  if (pct >= 70) return 'warn';
  return 'ok';
}

const BAR = { ok: 'bg-accent', warn: 'bg-warning', bad: 'bg-danger' };
const TEXT = { ok: 'text-ink', warn: 'text-warning', bad: 'text-danger' };

export default function Dashboard() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const [netHistory, setNetHistory] = useState<{ rx: number; tx: number }[]>([]);
  const prevNet = useRef<{ rx: number; tx: number } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [outputModal, setOutputModal] = useState<{ title: string; output: string } | null>(null);

  useEffect(() => {
    apiGet<SystemInfo>('/api/system/info').then(setInfo).catch(console.error);
    const socket = getSocket();
    socket.emit('stats:subscribe');
    socket.on('stats:update', (data: Stats) => {
      setStats(data);
      setCpuHistory(prev => [...prev.slice(-(HISTORY_SIZE - 1)), data.cpu]);
      setMemHistory(prev => [...prev.slice(-(HISTORY_SIZE - 1)), data.memory.percentage]);
      if (prevNet.current) {
        const rx = Math.max(0, data.network.rx - prevNet.current.rx) / 2;
        const tx = Math.max(0, data.network.tx - prevNet.current.tx) / 2;
        setNetHistory(prev => [...prev.slice(-(HISTORY_SIZE - 1)), { rx, tx }]);
      }
      prevNet.current = data.network;
    });
    return () => {
      socket.emit('stats:unsubscribe');
      socket.off('stats:update');
    };
  }, []);

  const doAction = async (action: string, label: string, danger = false) => {
    if (danger && !confirm(`${label}? This may interrupt running services.`)) return;
    setActionLoading(action);
    try {
      const res = await apiPost<{ success: boolean; message: string; output?: string }>(
        `/api/system/action/${action}`
      );
      if (res.output) setOutputModal({ title: label, output: res.output });
    } catch (e: any) {
      setOutputModal({ title: label, output: e.message });
    }
    setActionLoading(null);
  };

  const load = stats?.loadAvg?.[0];
  const loadPerCore = load != null && info?.cpuCount ? load / info.cpuCount : null;

  return (
    <div className="p-4 md:p-6 pb-10 max-w-[1400px] mx-auto">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">
            {info ? <span className="font-mono">{info.hostname}</span> : 'Connecting\u2026'}
            {info && <> &middot; up {formatUptime(info.uptime)}</>}
          </p>
        </div>
        <span className="pill pill-ok">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          Live
        </span>
      </div>

      {/* Metrics. Neutral by default: colour appears only past a threshold. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Metric
          icon={Cpu} label="CPU"
          value={stats ? `${stats.cpu.toFixed(1)}%` : '\u2014'}
          sub={info ? `${info.cpuCount} cores` : undefined}
          pct={stats?.cpu ?? 0}
        />
        <Metric
          icon={MemoryStick} label="Memory"
          value={stats ? `${stats.memory.percentage.toFixed(1)}%` : '\u2014'}
          sub={stats ? `${formatBytes(stats.memory.used)} of ${formatBytes(stats.memory.total)}` : undefined}
          pct={stats?.memory.percentage ?? 0}
        />
        <Metric
          icon={HardDrive} label="Disk"
          value={stats?.disk ? `${stats.disk.percentage.toFixed(1)}%` : '\u2014'}
          sub={stats?.disk ? `${formatBytes(stats.disk.used)} of ${formatBytes(stats.disk.total)}` : undefined}
          pct={stats?.disk?.percentage ?? 0}
        />
        <Metric
          icon={Clock} label="Load avg"
          value={load != null ? load.toFixed(2) : '\u2014'}
          sub={info ? `across ${info.cpuCount} cores` : undefined}
          pct={loadPerCore != null ? loadPerCore * 100 : 0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <Chart title="CPU" data={cpuHistory} suffix="%" />
        <Chart title="Memory" data={memHistory} suffix="%" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <NetworkCard history={netHistory} />
        <SystemInfoCard info={info} stats={stats} />
      </div>

      <QuickActions onAction={doAction} loading={actionLoading} />

      {outputModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70"
          onClick={() => setOutputModal(null)}
          role="dialog"
          aria-modal="true"
          aria-label={outputModal.title}
        >
          <div
            className="bg-surface border border-line rounded-modal w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="card-head">
              <h2 className="card-title">{outputModal.title}</h2>
              <button onClick={() => setOutputModal(null)} className="btn-icon" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="font-mono text-meta text-muted whitespace-pre-wrap break-all">
                {outputModal.output}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub, pct }: {
  icon: any; label: string; value: string; sub?: string; pct: number;
}) {
  const lv = level(pct);
  return (
    <div className="card p-3.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-muted shrink-0" />
        <span className="eyebrow">{label}</span>
      </div>
      <div className={`text-metric font-semibold tabular ${TEXT[lv]}`}>{value}</div>
      <div className="text-label text-muted mt-0.5 h-4 truncate tabular">{sub ?? ''}</div>
      <div className="mt-2.5 h-1 bg-raised rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${BAR[lv]}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Autoscales to a window around the data itself rather than 0-100, so a
 * value parked at 27% renders as a readable trace instead of a flat slab.
 */
function Chart({ title, data, suffix }: { title: string; data: number[]; suffix: string }) {
  const w = 400, h = 96, padY = 14;
  const current = data.length ? data[data.length - 1] : 0;
  const peak = data.length ? Math.max(...data) : 0;
  const low = data.length ? Math.min(...data) : 0;
  // Keep at least 8 points of span so small fluctuations stay visible.
  const span = Math.max(4, (peak - low) * 2.2);
  const mid = (peak + low) / 2;
  const lo = Math.max(0, mid - span / 2);
  const hi = Math.min(100, lo + span);
  const flat = peak - low < 0.05;
  const yOf = (v: number) =>
    h - padY - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo || 1)) * (h - padY * 2);
  // Inset horizontally so the stroke isn't half-clipped by the card edge.
  const padX = 10;
  const pts = (data.length < 2 ? [current, current] : data)
    .map((v, i, a) => `${(padX + (i / Math.max(1, a.length - 1)) * (w - padX * 2)).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ');
  const gid = `grad-${title}`;

  return (
    <div className="card">
      <div className="card-head max-sm:h-auto max-sm:py-2.5 max-sm:flex-col max-sm:items-start max-sm:gap-0.5">
        <h2 className="card-title">{title}</h2>
        <div className="flex items-baseline gap-2">
          <span className="text-label text-muted">{WINDOW_LABEL}</span>
          <span className="text-title font-semibold text-ink tabular">
            {current.toFixed(1)}{suffix}
          </span>
        </div>
      </div>
      <div className="px-3 pt-3 pb-3">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none" role="img"
             aria-label={`${title} ${WINDOW_LABEL}, currently ${current.toFixed(1)}${suffix}`}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Midline gives the trace a reference to be read against. */}
          <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="#1e2c2a" strokeWidth="1"
                vectorEffect="non-scaling-stroke" />
          <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${gid})`} />
          <polyline points={pts} fill="none" stroke="#14b8a6" strokeWidth="1.75"
                    strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="flex justify-between text-label text-muted mt-1.5 tabular">
          <span>{lo.toFixed(0)}–{hi.toFixed(0)}{suffix} range</span>
          <span>{flat ? `steady at ${current.toFixed(1)}${suffix}` : `low ${low.toFixed(1)} · peak ${peak.toFixed(1)}${suffix}`}</span>
        </div>
      </div>
    </div>
  );
}

function NetworkCard({ history }: { history: { rx: number; tx: number }[] }) {
  const cur = history.length ? history[history.length - 1] : { rx: 0, tx: 0 };
  const max = Math.max(512, ...history.map(p => Math.max(p.rx, p.tx)));
  const w = 400, h = 96, padY = 12;
  const line = (k: 'rx' | 'tx') =>
    (history.length < 2 ? [{ rx: 0, tx: 0 }, { rx: 0, tx: 0 }] : history)
      .map((v, i, a) => {
        const x = 10 + (i / Math.max(1, a.length - 1)) * (w - 20);
        const y = h - padY - (Math.min(v[k], max) / max) * (h - padY * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">Network</h2>
        <span className="text-label text-muted">{WINDOW_LABEL}</span>
      </div>
      <div className="px-3 pt-3 pb-3">
        {/* Rates are the content of this card, so they lead. */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-label text-muted">
              <ArrowDown className="w-3 h-3 shrink-0" /> Download
            </div>
            <div className="text-title font-semibold text-ink tabular truncate">{formatBytes(cur.rx)}/s</div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-label text-muted">
              <ArrowUp className="w-3 h-3 shrink-0" /> Upload
            </div>
            <div className="text-title font-semibold text-ink tabular truncate">{formatBytes(cur.tx)}/s</div>
          </div>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none" role="img"
             aria-label={`Network throughput, ${WINDOW_LABEL}`}>
          <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="#1e2c2a" strokeWidth="1"
                vectorEffect="non-scaling-stroke" />
          <polyline points={line('rx')} fill="none" stroke="#14b8a6" strokeWidth="1.75"
                    strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <polyline points={line('tx')} fill="none" stroke="#06b6d4" strokeWidth="1.75"
                    strokeLinejoin="round" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="flex gap-4 text-label text-muted mt-1">
          <span className="flex items-center gap-1.5">
            <svg width="14" height="3" aria-hidden="true"><line x1="0" y1="1.5" x2="14" y2="1.5" stroke="#14b8a6" strokeWidth="2" /></svg>
            down
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="14" height="3" aria-hidden="true"><line x1="0" y1="1.5" x2="14" y2="1.5" stroke="#06b6d4" strokeWidth="2" strokeDasharray="3 2" /></svg>
            up
          </span>
          <span className="ml-auto tabular">0 – {formatBytes(max)}/s</span>
        </div>
      </div>
    </div>
  );
}

function SystemInfoCard({ info, stats }: { info: SystemInfo | null; stats: Stats | null }) {
  if (!info) {
    return (
      <div className="card">
        <div className="card-head"><h2 className="card-title">System</h2></div>
        <div className="p-4 space-y-2" aria-busy="true">
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-4 bg-raised rounded animate-pulse" />)}
        </div>
      </div>
    );
  }

  const load = stats?.loadAvg;
  const perCore = load && info.cpuCount ? load[0] / info.cpuCount : 0;
  const loadLv = level(perCore * 100);

  const rows: { k: string; v: React.ReactNode }[] = [
    { k: 'IP address', v: info.ip },
    { k: 'Platform', v: `${info.platform} (${info.arch})` },
    { k: 'Cores', v: String(info.cpuCount) },
    {
      k: 'Load avg',
      v: load
        ? <span className={loadLv === 'ok' ? '' : TEXT[loadLv]}>
            {load.map(v => v.toFixed(2)).join('  ')}
          </span>
        : '\u2014',
    },
  ];

  return (
    <div className="card">
      <div className="card-head"><h2 className="card-title">System</h2></div>
      <div>
        {rows.map(({ k, v }) => (
          <div key={k} className="row">
            <span className="row-key">{k}</span>
            <span className="row-val">{v}</span>
          </div>
        ))}
        <div className="px-4 py-3 border-t border-line/70">
          <div className="row-key mb-1">Processor</div>
          <div className="text-meta text-ink font-mono leading-snug">{info.cpuModel}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Grouped by consequence. Previously eleven identical pills mixed
 * read-only lookups with service restarts at the same visual weight.
 */
function QuickActions({ onAction, loading }: {
  onAction: (action: string, label: string, danger?: boolean) => void;
  loading: string | null;
}) {
  const groups = [
    {
      title: 'Inspect', hint: 'Read-only',
      items: [
        { id: 'disk-usage', label: 'Disk usage', icon: HardDrive },
        { id: 'system-logs', label: 'System logs', icon: ScrollText },
        { id: 'network-info', label: 'Network info', icon: Wifi },
      ],
      danger: false,
    },
    {
      title: 'Maintain', hint: 'Safe to run',
      items: [
        { id: 'system-update', label: 'System update', icon: RefreshCw },
        { id: 'clear-cache', label: 'Clear cache', icon: Trash2 },
        { id: 'clear-tmp', label: 'Clear temp files', icon: Trash2 },
      ],
      danger: false,
    },
    {
      title: 'Restart services', hint: 'Interrupts traffic',
      items: [
        { id: 'restart-nginx', label: 'Nginx', icon: RotateCcw },
        { id: 'restart-ssh', label: 'SSH', icon: RotateCcw },
        { id: 'restart-pm2', label: 'PM2 apps', icon: RotateCcw },
        { id: 'restart-docker', label: 'Docker', icon: RotateCcw },
        { id: 'restart-openclaw', label: 'OpenClaw', icon: RotateCcw },
      ],
      danger: true,
    },
  ];

  return (
    <div className="card mt-3">
      <div className="card-head"><h2 className="card-title">Actions</h2></div>
      <div className="p-4 space-y-4">
        {groups.map(g => (
          <div key={g.title}>
            <div className="flex items-center gap-2 mb-2">
              <span className="eyebrow">{g.title}</span>
              <span className="pill pill-neutral">{g.hint}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {g.items.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => onAction(id, label, g.danger)}
                  disabled={loading === id}
                  className={`btn btn-sm ${g.danger ? 'btn-danger' : 'btn-quiet'}`}
                >
                  {loading === id
                    ? <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
                    : <Icon className="w-3.5 h-3.5 shrink-0" />}
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
