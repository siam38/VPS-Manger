import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { Search, RefreshCw, Skull, ArrowUpDown, ChevronUp, ChevronDown, AlertTriangle, X } from 'lucide-react';

interface Process {
  user: string;
  pid: number;
  cpu: number;
  memory: number;
  command: string;
}

type SortKey = 'cpu' | 'memory' | 'pid' | 'command';
type SortDir = 'asc' | 'desc';

export default function Processes() {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('cpu');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [killDialog, setKillDialog] = useState<Process | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = async () => {
    try {
      const data = await apiGet<Process[]>('/api/processes/list');
      setProcesses(data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [autoRefresh]);

  const sorted = [...processes]
    .filter(p => {
      if (!search) return true;
      const q = search.toLowerCase();
      return p.command.toLowerCase().includes(q) || p.user.toLowerCase().includes(q) || String(p.pid).includes(q);
    })
    .sort((a, b) => {
      let diff = 0;
      if (sortKey === 'cpu') diff = a.cpu - b.cpu;
      else if (sortKey === 'memory') diff = a.memory - b.memory;
      else if (sortKey === 'pid') diff = a.pid - b.pid;
      else diff = a.command.localeCompare(b.command);
      return sortDir === 'desc' ? -diff : diff;
    });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const handleKill = async (pid: number, signal: string) => {
    try {
      await apiPost('/api/processes/kill', { pid, signal });
      setKillDialog(null);
      setTimeout(load, 500);
    } catch (e: any) { alert(e.message); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 text-muted opacity-60" />;
    return sortDir === 'desc'
      ? <ChevronDown className="w-3 h-3 text-accent" />
      : <ChevronUp className="w-3 h-3 text-accent" />;
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line bg-surface/30">
        <div className="relative flex-1 min-w-[150px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search processes..."
            className="w-full pl-8 pr-3 py-1.5 bg-canvas border border-line rounded-lg text-sm text-white focus:outline-none focus:border-accent" />
        </div>
        <button onClick={() => setAutoRefresh(!autoRefresh)}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${autoRefresh ? 'bg-accent/10 text-accent border border-accent/20' : 'bg-raised text-muted border border-line'}`}>
          Auto: {autoRefresh ? 'ON' : 'OFF'}
        </button>
        <button onClick={load} className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-raised transition">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <span className="text-xs text-subtle">{sorted.length} processes</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface/95 backdrop-blur text-xs text-muted border-b border-line z-10">
            <tr>
              <th className="text-left px-3 py-2 font-medium cursor-pointer select-none" onClick={() => toggleSort('pid')}>
                <span className="flex items-center gap-1">PID <SortIcon col="pid" /></span>
              </th>
              <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">User</th>
              <th className="text-right px-3 py-2 font-medium cursor-pointer select-none" onClick={() => toggleSort('cpu')}>
                <span className="flex items-center justify-end gap-1">CPU% <SortIcon col="cpu" /></span>
              </th>
              <th className="text-right px-3 py-2 font-medium cursor-pointer select-none" onClick={() => toggleSort('memory')}>
                <span className="flex items-center justify-end gap-1">MEM% <SortIcon col="memory" /></span>
              </th>
              <th className="text-left px-3 py-2 font-medium cursor-pointer select-none" onClick={() => toggleSort('command')}>
                <span className="flex items-center gap-1">Command <SortIcon col="command" /></span>
              </th>
              <th className="w-12 px-2 py-2 font-medium text-center">Kill</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(proc => (
              <tr key={`${proc.pid}-${proc.command}`} className="border-b border-line/30 hover:bg-surface transition text-xs">
                <td className="px-3 py-1.5 font-mono text-muted">{proc.pid}</td>
                <td className="px-3 py-1.5 text-muted hidden sm:table-cell">{proc.user}</td>
                <td className="px-3 py-1.5 text-right">
                  <span className={`font-mono ${proc.cpu > 50 ? 'text-red-400' : proc.cpu > 20 ? 'text-amber-400' : 'text-muted'}`}>
                    {proc.cpu.toFixed(1)}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <span className={`font-mono ${proc.memory > 50 ? 'text-red-400' : proc.memory > 20 ? 'text-amber-400' : 'text-muted'}`}>
                    {proc.memory.toFixed(1)}
                  </span>
                </td>
                <td className="px-3 py-1.5 max-w-[200px] md:max-w-[400px]">
                  <span className="text-ink font-mono text-[11px] truncate block">{proc.command}</span>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button onClick={() => setKillDialog(proc)}
                    aria-label={`Kill process ${proc.pid}`}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-control text-muted hover:text-danger hover:bg-danger/10 transition-colors" title="Kill process">
                    <Skull className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Kill Dialog */}
      {killDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setKillDialog(null)}>
          <div className="bg-surface border border-line rounded-control p-5 max-w-sm w-full animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <h3 className="text-white font-medium">Kill Process</h3>
              <button onClick={() => setKillDialog(null)} className="ml-auto text-muted hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-muted text-sm mb-1">PID: <span className="text-white font-mono">{killDialog.pid}</span></p>
            <p className="text-muted text-xs font-mono mb-4 truncate">{killDialog.command}</p>
            <div className="flex gap-2">
              <button onClick={() => handleKill(killDialog.pid, 'TERM')}
                className="flex-1 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-sm font-medium hover:bg-amber-500/20 transition">
                SIGTERM
              </button>
              <button onClick={() => handleKill(killDialog.pid, 'KILL')}
                className="flex-1 py-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/20 transition">
                SIGKILL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
