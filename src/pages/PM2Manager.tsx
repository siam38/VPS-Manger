import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { getSocket } from '../lib/socket';
import { formatBytes } from '../lib/utils';
import {
  Play, Square, RotateCcw, Trash2, Plus, RefreshCw, X,
  Circle, ScrollText, Maximize2, Minimize2, Search, ArrowDown,
  ArrowDownToLine, Eraser, Filter, ChevronRight, ChevronDown,
  Folder, FolderOpen, File, FileCode, Settings, Save,
  Power, ArchiveRestore, Cpu, MemoryStick, Clock, AlertTriangle,
  Info, MoreVertical, Zap, Eye, EyeOff, Copy, Scale3D,
  ArrowLeft, Check, Loader2, Terminal, Globe, Hash, Database, Target, Boxes
} from 'lucide-react';

// ─── Types ───
interface PM2App {
  name: string;
  pm_id: number;
  monit: { cpu: number; memory: number };
  pm2_env: {
    status: string;
    restart_time: number;
    pm_uptime: number;
    exec_mode: string;
    instances: number;
    pm_exec_path: string;
    pm_cwd?: string;
    exec_interpreter?: string;
  };
}

interface AppDetail {
  name: string;
  pm_id: number;
  monit: { cpu: number; memory: number };
  status: string;
  exec_mode: string;
  instances: number;
  pm_exec_path: string;
  pm_cwd: string;
  pm_out_log_path: string;
  pm_err_log_path: string;
  created_at: number;
  restart_time: number;
  pm_uptime: number;
  node_version: string;
  versioning: any;
  watch: boolean;
  autorestart: boolean;
  max_memory_restart: any;
  cron_restart: string;
  args: string[];
  node_args: string[];
  interpreter: string;
  env_vars: Record<string, string>;
}

interface BrowseResult {
  path: string;
  parent: string;
  dirs: { name: string; path: string }[];
  projectFiles: { name: string; path: string; type: string }[];
}

interface LogLine {
  id: number;
  text: string;
  stream: 'out' | 'err';
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug' | 'log';
}

interface EnvVar {
  key: string;
  value: string;
}

let logIdCounter = 0;

// ─── Helpers ───
function parseLogLevel(text: string): LogLine['level'] {
  const lower = text.toLowerCase();
  if (/\b(error|err|fatal|exception|crash|uncaught)\b/i.test(lower)) return 'error';
  if (/\b(warn|warning)\b/i.test(lower)) return 'warn';
  if (/\b(debug|trace|verbose)\b/i.test(lower)) return 'debug';
  if (/\b(info)\b/i.test(lower)) return 'info';
  return 'log';
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function ansiToSpans(text: string): React.ReactNode {
  const parts = text.split(/(\x1b\[[0-9;]*m)/);
  let currentColor = '';
  const spans: React.ReactNode[] = [];
  const colorMap: Record<string, string> = {
    '30': '#64748b', '31': '#ef4444', '32': '#22c55e', '33': '#f59e0b',
    '34': '#3b82f6', '35': '#a855f7', '36': '#06b6d4', '37': '#e2e8f0',
    '90': '#64748b', '91': '#f87171', '92': '#4ade80', '93': '#fbbf24',
    '94': '#60a5fa', '95': '#c084fc', '96': '#22d3ee', '97': '#f8fafc',
  };

  parts.forEach((part, i) => {
    if (part.startsWith('\x1b[')) {
      const codes = part.slice(2, -1).split(';');
      for (const code of codes) {
        if (code === '0' || code === '') currentColor = '';
        else if (colorMap[code]) currentColor = colorMap[code];
      }
    } else if (part) {
      spans.push(
        <span key={i} style={currentColor ? { color: currentColor } : undefined}>{part}</span>
      );
    }
  });

  return spans.length > 0 ? <>{spans}</> : text;
}

function formatUptime(ms: number): string {
  if (!ms) return '-';
  const now = Date.now();
  const diff = now - ms;
  if (diff < 0) return '-';
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function detectInterpreter(filename: string): string {
  if (filename.endsWith('.py')) return 'python3';
  if (filename.endsWith('.sh')) return 'bash';
  if (filename.endsWith('.rb')) return 'ruby';
  if (filename.endsWith('.ts')) return 'node';
  return 'node';
}

// ─── Summary Bar Component ───
function SummaryBar({ apps }: { apps: PM2App[] }) {
  const online = apps.filter(a => a.pm2_env.status === 'online').length;
  const stopped = apps.filter(a => a.pm2_env.status === 'stopped').length;
  const errored = apps.filter(a => a.pm2_env.status === 'errored').length;
  const totalCpu = apps.reduce((s, a) => s + (a.monit?.cpu || 0), 0);
  const totalMem = apps.reduce((s, a) => s + (a.monit?.memory || 0), 0);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 px-3 py-2.5">
      <div className="flex items-center gap-2 px-3 py-2 bg-surface rounded-lg border border-line">
        <Database className="w-3.5 h-3.5 text-muted" />
        <div>
          <div className="text-[10px] text-subtle uppercase">Total</div>
          <div className="text-sm font-semibold text-white">{apps.length}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 bg-green-400/5 rounded-lg border border-green-400/10">
        <Circle className="w-3 h-3 fill-green-400 text-green-400" />
        <div>
          <div className="text-[10px] text-subtle uppercase">Online</div>
          <div className="text-sm font-semibold text-green-400">{online}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 bg-surface rounded-lg border border-line">
        <Square className="w-3 h-3 text-subtle" />
        <div>
          <div className="text-[10px] text-subtle uppercase">Stopped</div>
          <div className="text-sm font-semibold text-muted">{stopped}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 bg-red-400/5 rounded-lg border border-red-400/10">
        <AlertTriangle className="w-3 h-3 text-red-400" />
        <div>
          <div className="text-[10px] text-subtle uppercase">Errored</div>
          <div className="text-sm font-semibold text-red-400">{errored}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 bg-surface rounded-lg border border-line">
        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
        <div>
          <div className="text-[10px] text-subtle uppercase">CPU</div>
          <div className="text-sm font-semibold text-cyan-400">{totalCpu.toFixed(1)}%</div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 bg-surface rounded-lg border border-line">
        <MemoryStick className="w-3.5 h-3.5 text-purple-400" />
        <div>
          <div className="text-[10px] text-subtle uppercase">Memory</div>
          <div className="text-sm font-semibold text-purple-400">{formatBytes(totalMem)}</div>
        </div>
      </div>
    </div>
  );
}

// ─── New App Wizard ───
function NewAppWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(1);
  const [browsePath, setBrowsePath] = useState('/root');
  const [browseData, setBrowseData] = useState<BrowseResult | null>(null);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [selectedFile, setSelectedFile] = useState('');
  const [manualFile, setManualFile] = useState('');
  const [projectFiles, setProjectFiles] = useState<BrowseResult['projectFiles']>([]);
  const [appName, setAppName] = useState('');
  const [execMode, setExecMode] = useState<'fork' | 'cluster'>('fork');
  const [instances, setInstances] = useState('max');
  const [watchMode, setWatchMode] = useState(false);
  const [watchType, setWatchType] = useState<'all' | 'only'>('all');
  const [ignoreWatch, setIgnoreWatch] = useState('');
  const [watchOnly, setWatchOnly] = useState('');
  const [smartRestartCreate, setSmartRestartCreate] = useState(false);
  const [maxMemRestart, setMaxMemRestart] = useState('');
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [autoRestart, setAutoRestart] = useState(true);
  const [cronRestart, setCronRestart] = useState('');
  const [nodeArgs, setNodeArgs] = useState('');
  const [interpreter, setInterpreter] = useState('node');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const loadDir = useCallback(async (dirPath: string) => {
    setLoadingBrowse(true);
    try {
      const data = await apiGet<BrowseResult>(`/api/pm2/browse-dirs?path=${encodeURIComponent(dirPath)}`);
      setBrowseData(data);
      setBrowsePath(data.path);
      setProjectFiles(data.projectFiles);
    } catch (e: any) {
      setError(e.message);
    }
    setLoadingBrowse(false);
  }, []);

  useEffect(() => { loadDir('/root'); }, [loadDir]);

  const selectFolder = (folderPath: string) => {
    setSelectedFolder(folderPath);
    const folderName = folderPath.split('/').filter(Boolean).pop() || '';
    setAppName(folderName);
    loadDir(folderPath);
  };

  const confirmFolder = () => {
    if (!selectedFolder && browsePath) setSelectedFolder(browsePath);
    setStep(2);
  };

  const getStartFile = () => manualFile || selectedFile;

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const envObj: Record<string, string> = {};
      envVars.forEach(({ key, value }) => { if (key) envObj[key] = value; });
      if (smartRestartCreate) envObj['PANEL_SMART_RESTART'] = 'true';

      await apiPost('/api/pm2/start-advanced', {
        script: getStartFile(),
        name: appName,
        cwd: selectedFolder || browsePath,
        exec_mode: execMode,
        instances: execMode === 'cluster' ? instances : undefined,
        watch: watchMode,
        watch_type: watchMode ? watchType : undefined,
        ignore_watch: watchMode && watchType === 'all' && ignoreWatch.trim() ? ignoreWatch : undefined,
        watch_only: watchMode && watchType === 'only' && watchOnly.trim() ? watchOnly : undefined,
        max_memory_restart: maxMemRestart || undefined,
        env: Object.keys(envObj).length > 0 ? envObj : undefined,
        cron_restart: cronRestart || undefined,
        node_args: nodeArgs || undefined,
        interpreter,
        autorestart: autoRestart,
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
    setCreating(false);
  };

  const pathSegments = browsePath.split('/').filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
      <div className="bg-canvas border border-line rounded-card w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Plus className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">New PM2 Application</h3>
              <p className="text-[11px] text-muted">Step {step} of 4</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-raised transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex px-5 pt-3 gap-1">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-all ${s <= step ? 'bg-accent' : 'bg-raised'}`} />
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {error && (
            <div className="mb-3 px-3 py-2 bg-red-400/10 border border-red-400/20 rounded-lg text-red-400 text-xs">
              {error}
            </div>
          )}

          {/* Step 1: Select Folder */}
          {step === 1 && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Select Project Folder</h4>
              
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-xs text-muted flex-wrap">
                <button onClick={() => loadDir('/')} className="hover:text-accent transition">/</button>
                {pathSegments.map((seg, i) => (
                  <React.Fragment key={i}>
                    <ChevronRight className="w-3 h-3 text-muted" />
                    <button
                      onClick={() => loadDir('/' + pathSegments.slice(0, i + 1).join('/'))}
                      className="hover:text-accent transition"
                    >
                      {seg}
                    </button>
                  </React.Fragment>
                ))}
              </div>

              {/* Directory list */}
              <div className="border border-line rounded-lg max-h-64 overflow-auto bg-surface">
                {browseData?.parent && browseData.parent !== browseData.path && (
                  <button
                    onClick={() => loadDir(browseData.parent)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-raised text-muted text-xs border-b border-line transition"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>..</span>
                  </button>
                )}
                {loadingBrowse ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 text-accent animate-spin" />
                  </div>
                ) : browseData?.dirs.length === 0 ? (
                  <div className="text-center py-6 text-subtle text-xs">No subdirectories</div>
                ) : (
                  browseData?.dirs.map(dir => (
                    <button
                      key={dir.path}
                      onClick={() => selectFolder(dir.path)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition ${
                        selectedFolder === dir.path
                          ? 'bg-accent/10 text-accent border-l-2 border-accent'
                          : 'hover:bg-raised text-muted'
                      }`}
                    >
                      {selectedFolder === dir.path ? (
                        <FolderOpen className="w-3.5 h-3.5 text-accent" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 text-amber-400/60" />
                      )}
                      <span>{dir.name}</span>
                    </button>
                  ))
                )}
              </div>

              {/* Project files detected */}
              {projectFiles.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] text-subtle uppercase mb-1.5">Detected Project Files</div>
                  <div className="flex flex-wrap gap-1.5">
                    {projectFiles.map(f => (
                      <span key={f.path} className="px-2 py-1 bg-accent/10 text-accent text-[10px] rounded-md border border-accent/20">
                        {f.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-subtle">
                Selected: <span className="text-muted font-mono">{selectedFolder || browsePath}</span>
              </div>
            </div>
          )}

          {/* Step 2: Select Start File */}
          {step === 2 && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Select Start File</h4>
              <p className="text-[11px] text-subtle">
                From: <span className="font-mono text-muted">{selectedFolder || browsePath}</span>
              </p>

              {projectFiles.length > 0 && (
                <div className="border border-line rounded-lg overflow-hidden bg-surface">
                  {projectFiles.map(f => (
                    <button
                      key={f.path}
                      onClick={() => { setSelectedFile(f.name); setManualFile(''); }}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs transition border-b border-line/30 last:border-0 ${
                        selectedFile === f.name
                          ? 'bg-accent/10 text-accent'
                          : 'hover:bg-raised text-muted'
                      }`}
                    >
                      <FileCode className="w-3.5 h-3.5" />
                      <span className="font-mono">{f.name}</span>
                      <span className="ml-auto text-[10px] text-subtle uppercase">{f.type}</span>
                      {selectedFile === f.name && <Check className="w-3.5 h-3.5 text-accent" />}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 text-subtle text-[11px]">
                <div className="flex-1 h-px bg-raised" />
                <span>or enter manually</span>
                <div className="flex-1 h-px bg-raised" />
              </div>

              <input
                value={manualFile}
                onChange={e => { setManualFile(e.target.value); setSelectedFile(''); }}
                placeholder="e.g. src/index.js, npm start"
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-white focus:outline-none focus:border-accent font-mono"
              />
            </div>
          )}

          {/* Step 3: Configure */}
          {step === 3 && (
            <div className="space-y-4">
              <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Configure Application</h4>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* App Name */}
                <div>
                  <label className="text-[11px] text-muted block mb-1">App Name</label>
                  <input
                    value={appName}
                    onChange={e => setAppName(e.target.value)}
                    placeholder="my-app"
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-white focus:outline-none focus:border-accent"
                  />
                </div>

                {/* Interpreter */}
                <div>
                  <label className="text-[11px] text-muted block mb-1">Interpreter</label>
                  <select
                    value={interpreter}
                    onChange={e => setInterpreter(e.target.value)}
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-white focus:outline-none focus:border-accent"
                  >
                    <option value="node">Node.js</option>
                    <option value="python3">Python 3</option>
                    <option value="bash">Bash</option>
                    <option value="ruby">Ruby</option>
                    <option value="none">None (binary)</option>
                  </select>
                </div>
              </div>

              {/* Exec Mode */}
              <div>
                <label className="text-[11px] text-muted block mb-1.5">Execution Mode</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setExecMode('fork')}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition ${
                      execMode === 'fork'
                        ? 'bg-accent/10 border-accent/30 text-accent'
                        : 'bg-surface border-line text-muted hover:border-line-strong'
                    }`}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    Fork
                  </button>
                  <button
                    onClick={() => setExecMode('cluster')}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition ${
                      execMode === 'cluster'
                        ? 'bg-accent/10 border-accent/30 text-accent'
                        : 'bg-surface border-line text-muted hover:border-line-strong'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    Cluster
                  </button>
                </div>
              </div>

              {/* Instances (cluster only) */}
              {execMode === 'cluster' && (
                <div>
                  <label className="text-[11px] text-muted block mb-1">Instances</label>
                  <input
                    value={instances}
                    onChange={e => setInstances(e.target.value)}
                    placeholder="max or number"
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-white focus:outline-none focus:border-accent"
                  />
                </div>
              )}

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 px-3 py-2.5 bg-surface border border-line rounded-lg cursor-pointer hover:border-line-strong transition">
                  <input type="checkbox" checked={watchMode} onChange={e => setWatchMode(e.target.checked)} className="accent-cyan-400" />
                  <Eye className="w-3.5 h-3.5 text-muted" />
                  <span className="text-xs text-muted">Watch Mode</span>
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 bg-surface border border-line rounded-lg cursor-pointer hover:border-line-strong transition">
                  <input type="checkbox" checked={autoRestart} onChange={e => setAutoRestart(e.target.checked)} className="accent-cyan-400" />
                  <RotateCcw className="w-3.5 h-3.5 text-muted" />
                  <span className="text-xs text-muted">Auto Restart</span>
                </label>
              </div>

              {/* Smart Restart Toggle */}
              <div className="bg-surface rounded-lg border border-line p-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-cyan-400" />
                    <div>
                      <span className="text-xs text-white font-medium">Smart Restart</span>
                      <p className="text-[10px] text-subtle">Restart only from File Manager edits & Git pulls</p>
                    </div>
                  </div>
                  <input type="checkbox" checked={smartRestartCreate} onChange={e => setSmartRestartCreate(e.target.checked)} className="accent-cyan-400 w-4 h-4" />
                </label>
              </div>

              {/* Watch Mode Warning */}
              {watchMode && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-amber-300 font-medium">Watch Mode restarts on ANY file change</p>
                    <p className="text-[10px] text-amber-400/70 mt-0.5">If your app writes files (databases, logs, cache), it may restart in a loop. Consider using <strong>Smart Restart</strong> instead — it only triggers from File Manager edits and Git pulls, not from the app itself.</p>
                  </div>
                </div>
              )}

              {/* Watch Mode Options (shown when watch enabled) */}
              {watchMode && (
                <div className="space-y-3">
                  {/* Watch Type Toggle */}
                  <div>
                    <label className="text-[11px] text-muted block mb-1.5">Watch Type</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setWatchType('all')}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition ${
                          watchType === 'all'
                            ? 'bg-accent/10 border-accent/30 text-accent'
                            : 'bg-surface border-line text-muted hover:border-line-strong'
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Watch All
                      </button>
                      <button
                        onClick={() => setWatchType('only')}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition ${
                          watchType === 'only'
                            ? 'bg-accent/10 border-accent/30 text-accent'
                            : 'bg-surface border-line text-muted hover:border-line-strong'
                        }`}
                      >
                        <Target className="w-3.5 h-3.5" />
                        Watch Only
                      </button>
                    </div>
                  </div>

                  {/* Watch All → Ignore patterns */}
                  {watchType === 'all' && (
                    <div>
                      <label className="text-[11px] text-muted block mb-1">Ignore Patterns</label>
                      <input
                        value={ignoreWatch}
                        onChange={e => setIgnoreWatch(e.target.value)}
                        placeholder="Extra patterns (comma-sep), e.g. data/, *.json"
                        className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-white focus:outline-none focus:border-accent"
                      />
                      <p className="text-[10px] text-subtle mt-1">Auto-ignored: node_modules, .git, *.db, *.sqlite, *.log, logs</p>
                    </div>
                  )}

                  {/* Watch Only → Specific files/folders */}
                  {watchType === 'only' && (
                    <div>
                      <label className="text-[11px] text-muted block mb-1">Watch These Only</label>
                      <input
                        value={watchOnly}
                        onChange={e => setWatchOnly(e.target.value)}
                        placeholder="Files or folders (comma-sep), e.g. src/, index.js, config/"
                        className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-white focus:outline-none focus:border-accent"
                      />
                      <p className="text-[10px] text-subtle mt-1">Only restarts when these files/folders change</p>
                    </div>
                  )}
                </div>
              )}

              {/* Max Memory Restart */}
              <div>
                <label className="text-[11px] text-muted block mb-1">Max Memory Restart</label>
                <input
                  value={maxMemRestart}
                  onChange={e => setMaxMemRestart(e.target.value)}
                  placeholder="e.g. 200M, 1G"
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-white focus:outline-none focus:border-accent"
                />
              </div>

              {/* Cron Restart */}
              <div>
                <label className="text-[11px] text-muted block mb-1">Cron Restart (optional)</label>
                <input
                  value={cronRestart}
                  onChange={e => setCronRestart(e.target.value)}
                  placeholder="e.g. 0 0 * * * (daily at midnight)"
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-white focus:outline-none focus:border-accent font-mono"
                />
              </div>

              {/* Node Args */}
              <div>
                <label className="text-[11px] text-muted block mb-1">Node Args (optional)</label>
                <input
                  value={nodeArgs}
                  onChange={e => setNodeArgs(e.target.value)}
                  placeholder="e.g. --max-old-space-size=4096"
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-white focus:outline-none focus:border-accent font-mono"
                />
              </div>

              {/* Env Variables */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] text-muted">Environment Variables</label>
                  <button
                    onClick={() => setEnvVars([...envVars, { key: '', value: '' }])}
                    className="text-[10px] text-accent hover:underline"
                  >
                    + Add Variable
                  </button>
                </div>
                {envVars.map((v, i) => (
                  <div key={i} className="flex gap-2 mb-1.5">
                    <input
                      value={v.key}
                      onChange={e => {
                        const next = [...envVars];
                        next[i] = { ...next[i], key: e.target.value };
                        setEnvVars(next);
                      }}
                      placeholder="KEY"
                      className="flex-1 px-2 py-1.5 bg-surface border border-line rounded text-xs text-white focus:outline-none focus:border-accent font-mono"
                    />
                    <input
                      value={v.value}
                      onChange={e => {
                        const next = [...envVars];
                        next[i] = { ...next[i], value: e.target.value };
                        setEnvVars(next);
                      }}
                      placeholder="value"
                      className="flex-1 px-2 py-1.5 bg-surface border border-line rounded text-xs text-white focus:outline-none focus:border-accent font-mono"
                    />
                    <button
                      onClick={() => setEnvVars(envVars.filter((_, j) => j !== i))}
                      className="p-1.5 text-subtle hover:text-red-400 transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Review & Start */}
          {step === 4 && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Review & Launch</h4>
              
              <div className="bg-surface rounded-lg border border-line divide-y divide-dark-700/50">
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-xs text-subtle">Name</span>
                  <span className="text-xs text-white font-medium">{appName}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-xs text-subtle">Script</span>
                  <span className="text-xs text-accent font-mono">{getStartFile()}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-xs text-subtle">Directory</span>
                  <span className="text-xs text-muted font-mono truncate max-w-[60%]">{selectedFolder || browsePath}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-xs text-subtle">Mode</span>
                  <span className="text-xs text-muted">{execMode}{execMode === 'cluster' ? ` × ${instances}` : ''}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-xs text-subtle">Interpreter</span>
                  <span className="text-xs text-muted">{interpreter}</span>
                </div>
                {watchMode && (
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-xs text-subtle">Watch</span>
                    <span className="text-xs text-green-400">Enabled</span>
                  </div>
                )}
                {maxMemRestart && (
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-xs text-subtle">Max Memory</span>
                    <span className="text-xs text-muted">{maxMemRestart}</span>
                  </div>
                )}
                {cronRestart && (
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-xs text-subtle">Cron Restart</span>
                    <span className="text-xs text-muted font-mono">{cronRestart}</span>
                  </div>
                )}
                {nodeArgs && (
                  <div className="flex justify-between px-4 py-2.5">
                    <span className="text-xs text-subtle">Node Args</span>
                    <span className="text-xs text-muted font-mono">{nodeArgs}</span>
                  </div>
                )}
                {envVars.filter(v => v.key).length > 0 && (
                  <div className="px-4 py-2.5">
                    <span className="text-xs text-subtle block mb-1">Environment</span>
                    {envVars.filter(v => v.key).map((v, i) => (
                      <div key={i} className="text-[11px] font-mono text-muted">
                        <span className="text-cyan-400">{v.key}</span>=<span className="text-muted">{v.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-line bg-surface/30">
          <button
            onClick={() => step > 1 ? setStep(step - 1) : onClose()}
            className="px-3 py-1.5 text-xs text-muted hover:text-white transition"
          >
            {step > 1 ? '← Back' : 'Cancel'}
          </button>
          
          {step < 4 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 2 && !getStartFile()}
              className="px-4 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/80 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={creating || !appName || !getStartFile()}
              className="flex items-center gap-2 px-4 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/80 transition disabled:opacity-40"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Launch App
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── App Detail Modal ───
function AppDetailModal({ appName, onClose, onAction }: { appName: string; onClose: () => void; onAction: () => void }) {
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEnv, setShowEnv] = useState(false);
  const [scaleInput, setScaleInput] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [smartRestart, setSmartRestart] = useState(false);
  const [smartRestartLoading, setSmartRestartLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiGet<AppDetail>(`/api/pm2/app-detail/${encodeURIComponent(appName)}`);
        setDetail(data);
        // Check if smart restart is enabled
        setSmartRestart(data.env_vars?.PANEL_SMART_RESTART === 'true' || data.env_vars?.PANEL_SMART_RESTART === '1');
      } catch {}
      setLoading(false);
    })();
  }, [appName]);

  const doDetailAction = async (action: string, body?: any) => {
    setActionLoading(action);
    try {
      await apiPost(`/api/pm2/${action}`, body || { name_or_id: appName });
      onAction();
      // Refresh detail
      const data = await apiGet<AppDetail>(`/api/pm2/app-detail/${encodeURIComponent(appName)}`);
      setDetail(data);
    } catch (e: any) {
      alert(e.message);
    }
    setActionLoading('');
  };

  const envEntries = detail ? Object.entries(detail.env_vars || {}).filter(([k]) => 
    !k.startsWith('PM2_') && !k.startsWith('pm2_') && k !== 'NODE_APP_INSTANCE' && 
    k !== 'vizion_running' && k !== 'km_link' && !k.startsWith('unique_id')
  ) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
      <div className="bg-canvas border border-line rounded-card w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${detail?.status === 'online' ? 'bg-green-400' : detail?.status === 'errored' ? 'bg-red-400' : 'bg-line-strong'}`} />
            <div>
              <h3 className="text-sm font-semibold text-white">{appName}</h3>
              <p className="text-[11px] text-muted">{detail?.status || 'loading...'} · ID {detail?.pm_id}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-raised transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-accent animate-spin" />
          </div>
        ) : detail ? (
          <div className="flex-1 overflow-auto p-5 space-y-4">
            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'CPU', value: `${detail.monit?.cpu || 0}%`, icon: Cpu },
                { label: 'Memory', value: formatBytes(detail.monit?.memory || 0), icon: MemoryStick },
                { label: 'Uptime', value: formatUptime(detail.pm_uptime), icon: Clock },
                { label: 'Restarts', value: String(detail.restart_time), icon: RotateCcw },
                { label: 'Mode', value: detail.exec_mode?.replace('_mode', ''), icon: Terminal },
                { label: 'Instances', value: String(detail.instances || 1), icon: Globe },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2 px-3 py-2 bg-surface rounded-lg border border-line">
                  <item.icon className="w-3.5 h-3.5 text-subtle" />
                  <div>
                    <div className="text-[10px] text-subtle">{item.label}</div>
                    <div className="text-xs text-white font-medium">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Paths */}
            <div className="space-y-1.5">
              <div className="text-[10px] text-subtle uppercase">Paths</div>
              <div className="bg-surface rounded-lg border border-line divide-y divide-dark-700/30 font-mono text-[11px]">
                <div className="px-3 py-2 flex items-start gap-2">
                  <span className="text-subtle shrink-0 w-12">Script</span>
                  <span className="text-muted break-all">{detail.pm_exec_path}</span>
                </div>
                <div className="px-3 py-2 flex items-start gap-2">
                  <span className="text-subtle shrink-0 w-12">CWD</span>
                  <span className="text-muted break-all">{detail.pm_cwd}</span>
                </div>
                <div className="px-3 py-2 flex items-start gap-2">
                  <span className="text-subtle shrink-0 w-12">Out</span>
                  <span className="text-muted break-all">{detail.pm_out_log_path}</span>
                </div>
                <div className="px-3 py-2 flex items-start gap-2">
                  <span className="text-subtle shrink-0 w-12">Err</span>
                  <span className="text-muted break-all">{detail.pm_err_log_path}</span>
                </div>
              </div>
            </div>

            {/* Environment Variables */}
            {envEntries.length > 0 && (
              <div>
                <button
                  onClick={() => setShowEnv(!showEnv)}
                  className="flex items-center gap-1.5 text-[10px] text-subtle uppercase hover:text-muted transition"
                >
                  {showEnv ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  Environment Variables ({envEntries.length})
                </button>
                {showEnv && (
                  <div className="mt-1.5 bg-surface rounded-lg border border-line max-h-40 overflow-auto">
                    {envEntries.map(([k, v]) => (
                      <div key={k} className="flex px-3 py-1.5 text-[11px] font-mono border-b border-line/20 last:border-0">
                        <span className="text-cyan-400 shrink-0 mr-2">{k}</span>
                        <span className="text-muted truncate">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Scale (cluster) */}
            {detail.exec_mode?.includes('cluster') && (
              <div>
                <div className="text-[10px] text-subtle uppercase mb-1.5">Scale Instances</div>
                <div className="flex gap-2">
                  <input
                    value={scaleInput}
                    onChange={e => setScaleInput(e.target.value)}
                    placeholder={`Current: ${detail.instances || 1}`}
                    className="flex-1 px-3 py-1.5 bg-surface border border-line rounded-lg text-xs text-white focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => scaleInput && doDetailAction('scale', { name: appName, instances: scaleInput })}
                    disabled={!scaleInput}
                    className="px-3 py-1.5 bg-accent/10 text-accent rounded-lg text-xs font-medium hover:bg-accent/20 transition border border-accent/20 disabled:opacity-40"
                  >
                    Scale
                  </button>
                </div>
              </div>
            )}

            {/* Smart Restart */}
            <div>
              <div className="text-[10px] text-subtle uppercase mb-1.5">Smart Restart</div>
              <div className="bg-surface rounded-lg border border-line p-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <span className="text-xs text-white font-medium">Restart on external changes</span>
                    <p className="text-[10px] text-subtle mt-0.5">Auto-restart when files are edited via File Manager or Git Pull. Ignores changes made by the app itself.</p>
                  </div>
                  <div className="relative ml-3">
                    <input
                      type="checkbox"
                      checked={smartRestart}
                      disabled={smartRestartLoading}
                      onChange={async (e) => {
                        const enabled = e.target.checked;
                        setSmartRestartLoading(true);
                        try {
                          await apiPost('/api/pm2/smart-restart', { name: appName, enabled });
                          setSmartRestart(enabled);
                        } catch {}
                        setSmartRestartLoading(false);
                      }}
                      className="accent-cyan-400 w-4 h-4"
                    />
                    {smartRestartLoading && <Loader2 className="w-3 h-3 text-accent animate-spin absolute -right-5 top-0.5" />}
                  </div>
                </label>
              </div>
            </div>

            {/* Actions */}            <div>
              <div className="text-[10px] text-subtle uppercase mb-1.5">Actions</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { label: 'Restart', action: 'restart', icon: RotateCcw, color: 'text-blue-400 hover:bg-blue-400/10 border-blue-400/20' },
                  { label: 'Reload', action: 'reload', icon: RefreshCw, color: 'text-cyan-400 hover:bg-cyan-400/10 border-cyan-400/20' },
                  { label: detail?.status === 'online' ? 'Stop' : 'Start', action: detail?.status === 'online' ? 'stop' : 'start', icon: detail?.status === 'online' ? Square : Play, color: detail?.status === 'online' ? 'text-amber-400 hover:bg-amber-400/10 border-amber-400/20' : 'text-green-400 hover:bg-green-400/10 border-green-400/20' },
                  { label: 'Flush Logs', action: 'flush', icon: Eraser, color: 'text-purple-400 hover:bg-purple-400/10 border-purple-400/20' },
                  { label: 'Reset Count', action: 'reset', icon: Hash, color: 'text-muted hover:bg-raised border-line' },
                  { label: 'Delete', action: 'delete', icon: Trash2, color: 'text-red-400 hover:bg-red-400/10 border-red-400/20' },
                ].map(btn => (
                  <button
                    key={btn.action}
                    onClick={() => {
                      if (btn.action === 'delete') {
                        if (!confirm(`Delete ${appName}?`)) return;
                        doDetailAction('delete', { name_or_id: appName }).then(() => onClose());
                      } else {
                        doDetailAction(btn.action, { name_or_id: appName });
                      }
                    }}
                    disabled={actionLoading === btn.action}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition ${btn.color}`}
                  >
                    {actionLoading === btn.action ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <btn.icon className="w-3.5 h-3.5" />
                    )}
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-subtle text-xs">App not found</div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───
export default function PM2Manager() {
  const [apps, setApps] = useState<PM2App[]>([]);
  const [loading, setLoading] = useState(true);
  const [logApp, setLogApp] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [showNewApp, setShowNewApp] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logFilter, setLogFilter] = useState('');
  const [logLevelFilter, setLogLevelFilter] = useState<string>('all');
  const [detailApp, setDetailApp] = useState<string | null>(null);
  const [globalActionLoading, setGlobalActionLoading] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef(getSocket());

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    try {
      const data = await apiGet<PM2App[]>('/api/pm2/list');
      setApps(data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  // Live log subscription
  useEffect(() => {
    if (!logApp) return;
    const socket = socketRef.current;
    setLogs([]);
    logIdCounter = 0;

    socket.emit('pm2:logs:subscribe', { name: logApp });

    const handler = (data: { name: string; data: string; stream: string }) => {
      if (data.name === logApp) {
        const newLines: LogLine[] = data.data.split('\n').filter(Boolean).map(line => ({
          id: ++logIdCounter,
          text: line,
          stream: data.stream === 'err' ? 'err' : 'out',
          timestamp: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as any),
          level: parseLogLevel(stripAnsi(line)),
        }));
        setLogs(prev => [...prev, ...newLines].slice(-1000));
      }
    };
    socket.on('pm2:logs:data', handler);

    return () => {
      socket.emit('pm2:logs:unsubscribe', { name: logApp });
      socket.off('pm2:logs:data', handler);
    };
  }, [logApp]);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Escape to close fullscreen
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreen) setFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);

  const filteredLogs = useMemo(() => {
    return logs.filter(line => {
      if (logLevelFilter !== 'all' && line.level !== logLevelFilter) return false;
      if (logFilter && !stripAnsi(line.text).toLowerCase().includes(logFilter.toLowerCase())) return false;
      return true;
    });
  }, [logs, logFilter, logLevelFilter]);

  const doAction = async (action: string, name: string) => {
    try {
      await apiPost(`/api/pm2/${action}`, { name_or_id: name });
      setTimeout(load, 1000);
    } catch (e: any) { alert(e.message); }
  };

  const doGlobalAction = async (action: string) => {
    setGlobalActionLoading(action);
    try {
      const res = await apiPost<{ message?: string; output?: string }>(`/api/pm2/${action}`);
      showToast(res.message || `${action} completed`);
      if (action === 'resurrect') setTimeout(load, 1500);
    } catch (e: any) {
      alert(e.message);
    }
    setGlobalActionLoading('');
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'online': return 'text-green-400';
      case 'stopping': return 'text-amber-400';
      case 'stopped': return 'text-subtle';
      case 'errored': return 'text-red-400';
      default: return 'text-muted';
    }
  };

  const statusBg = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-400/10 border-green-400/20';
      case 'stopped': return 'bg-raised border-line';
      case 'errored': return 'bg-red-400/10 border-red-400/20';
      default: return 'bg-raised border-line';
    }
  };

  const levelColor = (level: LogLine['level']) => {
    switch (level) {
      case 'error': return 'text-red-400';
      case 'warn': return 'text-amber-400';
      case 'info': return 'text-blue-400';
      case 'debug': return 'text-subtle';
      default: return 'text-muted';
    }
  };

  const streamBorderColor = (stream: 'out' | 'err') => {
    return stream === 'err' ? 'border-l-red-500/60' : 'border-l-cyan-500/30';
  };

  const renderLogViewer = (isFullscreen: boolean) => (
    <div className={isFullscreen ? 'fixed inset-0 z-[100] bg-[#080c16] flex flex-col animate-fade-in' : 'border-t border-line'}>
      {/* Log Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-canvas/80 border-b border-line">
        <span className="text-[11px] text-muted flex items-center gap-1.5 mr-2">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
          <span className="font-medium text-muted">{logApp}</span>
          <span className="text-muted">·</span>
          <span>{filteredLogs.length} lines</span>
        </span>

        {/* Search */}
        <div className="relative flex-1 min-w-[120px] max-w-[250px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-subtle" />
          <input
            value={logFilter}
            onChange={e => setLogFilter(e.target.value)}
            placeholder="Filter logs..."
            className="w-full pl-7 pr-2 py-1 bg-surface border border-line rounded text-[11px] text-white focus:outline-none focus:border-accent"
          />
        </div>

        {/* Level filter */}
        <select
          value={logLevelFilter}
          onChange={e => setLogLevelFilter(e.target.value)}
          className="px-2 py-1 bg-surface border border-line rounded text-[11px] text-muted focus:outline-none focus:border-accent"
        >
          <option value="all">All Levels</option>
          <option value="error">Error</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
          <option value="log">Log</option>
        </select>

        <div className="flex items-center gap-1 ml-auto">
          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1.5 rounded transition text-[10px] flex items-center gap-1 ${autoScroll ? 'bg-accent/10 text-accent' : 'text-subtle hover:text-muted hover:bg-surface'}`}
            title="Auto-scroll"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
          </button>

          {/* Clear */}
          <button
            onClick={() => setLogs([])}
            className="p-1.5 rounded text-subtle hover:text-amber-400 hover:bg-amber-400/10 transition"
            title="Clear logs"
          >
            <Eraser className="w-3.5 h-3.5" />
          </button>

          {/* Fullscreen toggle */}
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="p-1.5 rounded text-subtle hover:text-white hover:bg-surface transition"
            title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
          >
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Close */}
          <button
            onClick={() => { setLogApp(null); setFullscreen(false); }}
            className="p-1.5 rounded text-subtle hover:text-white hover:bg-surface transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Log Content */}
      <div
        ref={logRef}
        className={`overflow-auto bg-[#080c16] font-mono text-[11px] leading-[1.6] ${isFullscreen ? 'flex-1' : 'h-56 md:h-72'}`}
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-subtle text-xs">
            {logs.length === 0 ? 'Waiting for logs...' : 'No logs match filter'}
          </div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {filteredLogs.map((line) => (
                <tr
                  key={line.id}
                  className={`border-l-2 ${streamBorderColor(line.stream)} hover:bg-white/[0.02] group`}
                >
                  <td className="text-muted text-[10px] px-2 py-0 select-none text-right align-top whitespace-nowrap w-[1%]">
                    {line.id}
                  </td>
                  <td className="text-subtle text-[10px] px-2 py-0 select-none align-top whitespace-nowrap w-[1%]">
                    {line.timestamp}
                  </td>
                  <td className="px-1 py-0 align-top whitespace-nowrap w-[1%]">
                    <span className={`text-[9px] font-medium uppercase ${line.stream === 'err' ? 'text-red-400/60' : 'text-cyan-400/40'}`}>
                      {line.stream === 'err' ? 'ERR' : 'OUT'}
                    </span>
                  </td>
                  <td className={`px-2 py-0 ${levelColor(line.level)} whitespace-pre-wrap break-all`}>
                    {ansiToSpans(line.text)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-[200] px-4 py-2 bg-accent/90 text-white text-xs font-medium rounded-lg shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line bg-surface/30">
        <h2 className="text-body font-semibold text-ink flex-1">PM2</h2>

        {/* Global PM2 Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => doGlobalAction('save')}
            disabled={globalActionLoading === 'save'}
            className="btn btn-sm btn-quiet"
            title="PM2 Save"
          >
            {globalActionLoading === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Save</span>
          </button>
          <button
            onClick={() => doGlobalAction('startup')}
            disabled={globalActionLoading === 'startup'}
            className="btn btn-sm btn-quiet"
            title="PM2 Startup"
          >
            {globalActionLoading === 'startup' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Startup</span>
          </button>
          <button
            onClick={() => doGlobalAction('resurrect')}
            disabled={globalActionLoading === 'resurrect'}
            className="btn btn-sm btn-quiet"
            title="PM2 Resurrect"
          >
            {globalActionLoading === 'resurrect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Resurrect</span>
          </button>
        </div>

        {/* With no apps, the empty state owns the primary action - a second
            CTA here just wraps the toolbar on narrow screens. */}
        {apps.length > 0 && (
          <button onClick={() => setShowNewApp(true)} className="btn btn-sm btn-primary">
            <Plus className="w-3.5 h-3.5" /> New app
          </button>
        )}
        <button onClick={load} className="btn-icon" aria-label="Refresh apps">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary Bar */}
      {apps.length > 0 && <SummaryBar apps={apps} />}

      {/* App List */}
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {apps.length === 0 && !loading && (
          <div className="empty">
            <Boxes className="w-8 h-8 text-muted mb-2" />
            <p className="empty-title">No apps running</p>
            <p className="empty-sub">
              PM2 keeps Node processes alive and restarts them on crash. Add one to get started,
              or restore a previously saved list.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              <button onClick={() => setShowNewApp(true)} className="btn btn-primary">
                <Plus className="w-4 h-4" /> Add app
              </button>
              <button onClick={() => doGlobalAction('resurrect')} className="btn btn-quiet">
                <ArchiveRestore className="w-4 h-4" /> Restore saved apps
              </button>
            </div>
          </div>
        )}

        {apps.map(app => (
          <div key={app.pm_id} className={`border rounded-control overflow-hidden ${statusBg(app.pm2_env.status)}`}>
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Status dot */}
              <Circle className={`w-2.5 h-2.5 fill-current shrink-0 ${statusColor(app.pm2_env.status)}`} />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{app.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${statusBg(app.pm2_env.status)} ${statusColor(app.pm2_env.status)} uppercase font-medium`}>
                    {app.pm2_env.status}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-raised border border-line text-muted uppercase">
                    {app.pm2_env.exec_mode?.replace('_mode', '') || 'fork'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted mt-0.5">
                  <span>ID: {app.pm_id}</span>
                  <span>CPU: {app.monit.cpu}%</span>
                  <span>MEM: {formatBytes(app.monit.memory)}</span>
                  <span>↻ {app.pm2_env.restart_time}</span>
                  <span>⏱ {formatUptime(app.pm2_env.pm_uptime)}</span>
                  <span className="hidden sm:inline truncate max-w-[250px] font-mono">{app.pm2_env.pm_exec_path}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setDetailApp(app.name)}
                  className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-raised transition"
                  title="Details">
                  <Info className="w-4 h-4" />
                </button>
                <button onClick={() => setLogApp(logApp === app.name ? null : app.name)}
                  className={`p-1.5 rounded-lg transition ${logApp === app.name ? 'bg-accent/10 text-accent' : 'text-muted hover:text-white hover:bg-raised'}`}
                  title="Logs">
                  <ScrollText className="w-4 h-4" />
                </button>
                {app.pm2_env.status === 'online' ? (
                  <button onClick={() => doAction('stop', app.name)}
                    className="p-1.5 rounded-lg text-muted hover:text-amber-400 hover:bg-amber-400/10 transition" title="Stop">
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button onClick={() => doAction('start', app.name)}
                    className="p-1.5 rounded-lg text-muted hover:text-green-400 hover:bg-green-400/10 transition" title="Start">
                    <Play className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => doAction('restart', app.name)}
                  className="p-1.5 rounded-lg text-muted hover:text-blue-400 hover:bg-blue-400/10 transition" title="Restart">
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button onClick={() => { if (confirm(`Delete ${app.name}?`)) doAction('delete', app.name); }}
                  className="p-1.5 rounded-lg text-muted hover:text-red-400 hover:bg-red-400/10 transition" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Live Logs - inline (non-fullscreen) */}
            {logApp === app.name && !fullscreen && renderLogViewer(false)}
          </div>
        ))}
      </div>

      {/* Fullscreen log overlay */}
      {fullscreen && logApp && renderLogViewer(true)}

      {/* New App Wizard Modal */}
      {showNewApp && <NewAppWizard onClose={() => setShowNewApp(false)} onCreated={load} />}

      {/* App Detail Modal */}
      {detailApp && <AppDetailModal appName={detailApp} onClose={() => setDetailApp(null)} onAction={load} />}
    </div>
  );
}