import React, { useEffect, useState, useRef } from 'react';
import { apiGet } from '../lib/api';
import { getSocket } from '../lib/socket';
import { formatBytes, formatUptime } from '../lib/utils';
import { 
  Cpu, MemoryStick, HardDrive, Network, Clock, Server, 
  Zap, Trash2, RotateCcw, Shield, Boxes, RefreshCw,
  Wifi, X, ScrollText, Container, Heart
} from 'lucide-react';
import { apiPost } from '../lib/api';

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
        const rxRate = Math.max(0, data.network.rx - prevNet.current.rx) / 2;
        const txRate = Math.max(0, data.network.tx - prevNet.current.tx) / 2;
        setNetHistory(prev => [...prev.slice(-(HISTORY_SIZE - 1)), { rx: rxRate, tx: txRate }]);
      }
      prevNet.current = data.network;
    });

    return () => {
      socket.emit('stats:unsubscribe');
      socket.off('stats:update');
    };
  }, []);

  const doAction = async (action: string, label: string, danger: boolean = false) => {
    if (danger && !confirm(`Are you sure you want to ${label}? This action may affect system stability.`)) {
      return;
    }
    setActionLoading(action);
    try {
      const res = await apiPost<{ success: boolean; message: string; output?: string }>(`/api/system/action/${action}`);
      if (res.output) {
        setOutputModal({ title: label, output: res.output });
      }
    } catch (e: any) {
      setOutputModal({ title: `Error: ${label}`, output: e.message });
    }
    setActionLoading(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <MetricCard
          icon={Cpu} label="CPU" color="teal"
          value={`${(stats?.cpu ?? 0).toFixed(1)}%`}
          percentage={stats?.cpu ?? 0}
        />
        <MetricCard
          icon={MemoryStick} label="Memory" color="cyan"
          value={stats ? formatBytes(stats.memory.used) : '\u2014'}
          sub={stats ? `/ ${formatBytes(stats.memory.total)}` : ''}
          percentage={stats?.memory.percentage ?? 0}
        />
        <MetricCard
          icon={HardDrive} label="Disk" color="orange"
          value={stats?.disk ? formatBytes(stats.disk.used) : '\u2014'}
          sub={stats?.disk ? `/ ${formatBytes(stats.disk.total)}` : ''}
          percentage={stats?.disk?.percentage ?? 0}
        />
        <MetricCard
          icon={Clock} label="Uptime" color="rose"
          value={info ? formatUptime(info.uptime) : '\u2014'}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        <ChartCard title="CPU Usage" data={cpuHistory} color="#14b8a6" max={100} suffix="%" />
        <ChartCard title="Memory Usage" data={memHistory} color="#06b6d4" max={100} suffix="%" />
      </div>

      {/* Network & Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        <NetworkCard history={netHistory} />
        <div className="space-y-3 md:space-y-4">
          <InfoCard info={info} stats={stats} />
          <QuickActions onAction={doAction} loading={actionLoading} />
        </div>
      </div>

      {/* Dashboard Footer */}
      <div className="text-center py-4 border-t border-dark-700/50">
        <p className="text-[11px] text-dark-500 flex items-center justify-center gap-1.5">
          Made by <span className="text-dark-300 font-semibold">Siam</span> with <Heart className="w-3 h-3 text-rose-400 fill-rose-400 animate-pulse" /> 
          <span className="text-dark-600 mx-1">•</span>
          <span className="text-accent font-medium">VPS Manager v3.1</span>
          <span className="text-dark-600 mx-1">•</span>
          <span className="text-dark-500">🦊</span>
        </p>
      </div>

      {/* Output Modal */}
      {outputModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setOutputModal(null)}>
          <div className="bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-dark-700">
              <h3 className="text-sm font-semibold text-white">{outputModal.title}</h3>
              <button onClick={() => setOutputModal(null)} className="p-1.5 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="font-mono text-[11px] text-dark-200 whitespace-pre-wrap break-all leading-relaxed">{outputModal.output}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Metric Card ───
function MetricCard({ icon: Icon, label, color, value, sub, percentage }: {
  icon: any; label: string; color: string; value: string; sub?: string;
  percentage?: number;
}) {
  const colorMap: Record<string, string> = {
    teal: 'from-teal-500/15 via-teal-500/5 to-transparent border-teal-500/20',
    cyan: 'from-cyan-500/15 via-cyan-500/5 to-transparent border-cyan-500/20',
    orange: 'from-orange-500/15 via-orange-500/5 to-transparent border-orange-500/20',
    rose: 'from-rose-500/15 via-rose-500/5 to-transparent border-rose-500/20',
  };
  const iconColor: Record<string, string> = {
    teal: 'text-teal-400', cyan: 'text-cyan-400', orange: 'text-orange-400', rose: 'text-rose-400',
  };
  const barColor: Record<string, string> = {
    teal: 'bg-gradient-to-r from-teal-600 to-teal-400', 
    cyan: 'bg-gradient-to-r from-cyan-600 to-cyan-400', 
    orange: 'bg-gradient-to-r from-orange-600 to-orange-400', 
    rose: 'bg-gradient-to-r from-rose-600 to-rose-400',
  };
  const glowColor: Record<string, string> = {
    teal: 'shadow-teal-500/10', cyan: 'shadow-cyan-500/10', orange: 'shadow-orange-500/10', rose: 'shadow-rose-500/10',
  };

  return (
    <div className={`bg-gradient-to-br ${colorMap[color]} backdrop-blur-sm border rounded-2xl p-3.5 md:p-4 relative overflow-hidden shadow-lg ${glowColor[color]}`}>
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br from-white/5 to-transparent blur-2xl" />
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-2">
          <div className={`p-1.5 rounded-lg bg-white/5 ${iconColor[color]}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] text-dark-300 font-medium uppercase tracking-wider">{label}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-xl md:text-2xl font-bold text-white tracking-tight">{value}</span>
          {sub && <span className="text-[11px] text-dark-400">{sub}</span>}
        </div>
        {percentage !== undefined && (
          <div className="mt-2.5 h-1.5 bg-dark-700/60 rounded-full overflow-hidden">
            <div className={`h-full ${barColor[color]} rounded-full transition-all duration-700 ease-out`}
                 style={{ width: `${Math.min(100, percentage)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mini Chart ───
function ChartCard({ title, data, color, max, suffix }: {
  title: string; data: number[]; color: string; max: number; suffix: string;
}) {
  const h = 120;
  const w = 400;
  const padded = data.length < 2 ? [0, 0] : data;
  const points = padded.map((v, i) => {
    const x = (i / Math.max(1, padded.length - 1)) * w;
    const y = h - (Math.min(v, max) / max) * (h - 10) - 5;
    return `${x},${y}`;
  }).join(' ');
  const area = `0,${h} ${points} ${w},${h}`;
  const current = data.length > 0 ? data[data.length - 1] : 0;

  return (
    <div className="bg-gradient-to-br from-dark-800 to-dark-800/80 backdrop-blur-sm border border-dark-700/80 rounded-2xl p-4 overflow-hidden shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-dark-200">{title}</h3>
        <span className="text-lg font-bold text-white">{current.toFixed(1)}{suffix}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24 md:h-28">
        <defs>
          <linearGradient id={`g-${title}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[25, 50, 75].map(v => (
          <line key={v} x1="0" y1={h - (v / max) * (h - 10) - 5} x2={w} y2={h - (v / max) * (h - 10) - 5}
                stroke="#1a2b2a" strokeWidth="1" />
        ))}
        <polygon points={area} fill={`url(#g-${title})`} />
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ─── Network Card ───
function NetworkCard({ history }: { history: { rx: number; tx: number }[] }) {
  const current = history.length > 0 ? history[history.length - 1] : { rx: 0, tx: 0 };
  const maxVal = Math.max(1, ...history.map(h => Math.max(h.rx, h.tx)));
  const h = 120, w = 400;

  const makePoints = (key: 'rx' | 'tx') => {
    const data = history.length < 2 ? [{ rx: 0, tx: 0 }, { rx: 0, tx: 0 }] : history;
    return data.map((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * w;
      const y = h - (Math.min(v[key], maxVal) / maxVal) * (h - 10) - 5;
      return `${x},${y}`;
    }).join(' ');
  };

  return (
    <div className="bg-gradient-to-br from-dark-800 to-dark-800/80 backdrop-blur-sm border border-dark-700/80 rounded-2xl p-4 overflow-hidden shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-dark-200 flex items-center gap-2">
          <Network className="w-4 h-4 text-teal-400" /> Network
        </h3>
        <div className="flex gap-4 text-xs">
          <span className="text-teal-400">&darr; {formatBytes(current.rx)}/s</span>
          <span className="text-orange-400">&uarr; {formatBytes(current.tx)}/s</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24 md:h-28">
        {[25, 50, 75].map(v => (
          <line key={v} x1="0" y1={h - (v / 100) * (h - 10) - 5} x2={w} y2={h - (v / 100) * (h - 10) - 5}
                stroke="#1a2b2a" strokeWidth="1" />
        ))}
        <polyline points={makePoints('rx')} fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinejoin="round" opacity="0.8" />
        <polyline points={makePoints('tx')} fill="none" stroke="#f97316" strokeWidth="2" strokeLinejoin="round" opacity="0.8" />
      </svg>
    </div>
  );
}

// ─── Info Card ───
function InfoCard({ info, stats }: { info: SystemInfo | null; stats: Stats | null }) {
  if (!info) return null;
  const items = [
    { label: 'Hostname', value: info.hostname },
    { label: 'OS', value: info.platform },
    { label: 'CPU', value: `${info.cpuModel} (${info.cpuCount} cores)` },
    { label: 'IP', value: info.ip },
    { label: 'Load Avg', value: stats?.loadAvg?.map(v => v.toFixed(2)).join(', ') || '\u2014' },
  ];

  return (
    <div className="bg-gradient-to-br from-dark-800 to-dark-800/80 backdrop-blur-sm border border-dark-700/80 rounded-2xl p-4 shadow-lg">
      <h3 className="text-sm font-medium text-dark-200 mb-3 flex items-center gap-2">
        <Server className="w-4 h-4 text-accent" /> System Info
      </h3>
      <div className="space-y-2">
        {items.map(({ label, value }) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-dark-400">{label}</span>
            <span className="text-dark-200 text-right truncate ml-2 max-w-[200px]">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Quick Actions ───
function QuickActions({ onAction, loading }: { onAction: (action: string, label: string, danger?: boolean) => void; loading: string | null }) {
  const actions = [
    { id: 'clear-cache', label: 'Clear Cache', icon: Trash2, color: 'text-orange-400', danger: true },
    { id: 'restart-nginx', label: 'Restart Nginx', icon: RotateCcw, color: 'text-cyan-400', danger: true },
    { id: 'restart-ssh', label: 'Restart SSH', icon: Shield, color: 'text-teal-400', danger: true },
    { id: 'restart-pm2', label: 'Restart PM2 All', icon: Boxes, color: 'text-violet-400', danger: true },
    { id: 'system-update', label: 'System Update', icon: RefreshCw, color: 'text-sky-400', danger: false },
    { id: 'disk-usage', label: 'Disk Usage', icon: HardDrive, color: 'text-amber-400', danger: false },
    { id: 'system-logs', label: 'System Logs', icon: ScrollText, color: 'text-rose-400', danger: false },
    { id: 'restart-docker', label: 'Restart Docker', icon: Container, color: 'text-blue-400', danger: true },
    { id: 'restart-openclaw', label: 'Restart OpenClaw', icon: Zap, color: 'text-emerald-400', danger: true },
    { id: 'network-info', label: 'Network Info', icon: Wifi, color: 'text-teal-300', danger: false },
    { id: 'clear-tmp', label: 'Clear Tmp Files', icon: Trash2, color: 'text-red-400', danger: true },
  ];

  return (
    <div className="bg-gradient-to-br from-dark-800 to-dark-800/80 backdrop-blur-sm border border-dark-700/80 rounded-2xl p-4 shadow-lg">
      <h3 className="text-sm font-medium text-dark-200 mb-3 flex items-center gap-2">
        <Zap className="w-4 h-4 text-orange-400" /> Quick Actions
      </h3>
      <div className="grid grid-cols-2 gap-1.5">
        {actions.map(({ id, label, icon: Icon, color, danger }) => (
          <button
            key={id}
            onClick={() => onAction(id, label, danger)}
            disabled={loading === id}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-xl ${danger ? 'bg-red-500/5 hover:bg-red-500/10 border-red-500/20' : 'bg-dark-700/40 hover:bg-dark-700/80 border-transparent'} hover:border-dark-600 text-dark-200 text-[11px] transition disabled:opacity-50 border`}
          >
            {loading === id ? (
              <div className="w-3.5 h-3.5 border border-dark-300 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            ) : (
              <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${color}`} />
            )}
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
