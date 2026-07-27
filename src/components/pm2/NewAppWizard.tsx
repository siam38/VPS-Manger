import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Check, ChevronRight, FileCode, Folder, FolderOpen,
  Loader2, Plus, Target, X, Zap,
} from 'lucide-react';
import { apiGet, apiPost } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { getPlatform } from '../../lib/platform';
import type { BrowseResult } from '../../lib/pm2';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

interface EnvVar { key: string; value: string }

const STEPS = ['Folder', 'Script', 'Options', 'Review'];

/**
 * New application wizard.
 *
 * Same four steps and the same PM2 options as before — nothing was dropped —
 * but the shell is a bottom sheet on mobile instead of a centred modal with
 * `max-h-[90vh]` and margins on all four sides, and the step rail now shows
 * where you are by name rather than "Step 3 of 4" over four anonymous bars.
 *
 * The browse root is no longer a hard-coded '/root'. It comes from server-side
 * detection, so on a Debian host this opens somewhere that actually exists.
 */
export function NewAppWizard({ onClose, onCreated }: Props) {
  const toast = useToast();
  const [step, setStep] = useState(1);

  const [browsePath, setBrowsePath] = useState('');
  const [browseData, setBrowseData] = useState<BrowseResult | null>(null);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [projectFiles, setProjectFiles] = useState<BrowseResult['projectFiles']>([]);

  const [selectedFile, setSelectedFile] = useState('');
  const [manualFile, setManualFile] = useState('');

  const [appName, setAppName] = useState('');
  const [execMode, setExecMode] = useState<'fork' | 'cluster'>('fork');
  const [instances, setInstances] = useState('max');
  const [interpreter, setInterpreter] = useState('node');
  const [watchMode, setWatchMode] = useState(false);
  const [watchType, setWatchType] = useState<'all' | 'only'>('all');
  const [ignoreWatch, setIgnoreWatch] = useState('');
  const [watchOnly, setWatchOnly] = useState('');
  const [smartRestart, setSmartRestart] = useState(false);
  const [maxMemRestart, setMaxMemRestart] = useState('');
  const [autoRestart, setAutoRestart] = useState(true);
  const [saveForBoot, setSaveForBoot] = useState(true);
  const [cronRestart, setCronRestart] = useState('');
  const [nodeArgs, setNodeArgs] = useState('');
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [creating, setCreating] = useState(false);

  const loadDir = useCallback(async (dirPath: string) => {
    setLoadingBrowse(true);
    try {
      const data = await apiGet<BrowseResult>(`/api/pm2/browse-dirs?path=${encodeURIComponent(dirPath)}`);
      setBrowseData(data);
      setBrowsePath(data.path);
      setProjectFiles(data.projectFiles);
    } catch (e: any) {
      toast.error({ title: 'Could not read folder', description: e.message });
    }
    setLoadingBrowse(false);
  }, [toast]);

  // Start where the host actually keeps projects, not a literal '/root'.
  useEffect(() => {
    let alive = true;
    getPlatform().then(info => { if (alive) loadDir(info.defaultPath); });
    return () => { alive = false; };
    /* eslint-disable-next-line */
  }, []);

  const startFile = manualFile || selectedFile;
  const targetDir = selectedFolder || browsePath;

  const canContinue =
    (step === 1 && !!targetDir) ||
    (step === 2 && !!startFile) ||
    (step === 3 && !!appName.trim());

  const create = async () => {
    setCreating(true);
    try {
      const envObj: Record<string, string> = {};
      envVars.forEach(({ key, value }) => { if (key) envObj[key] = value; });
      if (smartRestart) envObj['PANEL_SMART_RESTART'] = 'true';

      await apiPost('/api/pm2/start-advanced', {
        script: startFile,
        name: appName.trim(),
        cwd: targetDir,
        exec_mode: execMode,
        instances: execMode === 'cluster' ? instances : undefined,
        watch: watchMode,
        watch_type: watchMode ? watchType : undefined,
        ignore_watch: watchMode && watchType === 'all' && ignoreWatch.trim() ? ignoreWatch : undefined,
        watch_only: watchMode && watchType === 'only' && watchOnly.trim() ? watchOnly : undefined,
        max_memory_restart: maxMemRestart || undefined,
        env: Object.keys(envObj).length ? envObj : undefined,
        cron_restart: cronRestart || undefined,
        node_args: nodeArgs || undefined,
        interpreter,
        autorestart: autoRestart,
      });

      // Starting an app without saving means it silently disappears on the
      // next reboot. Offer it inline rather than making people find it later.
      if (saveForBoot) {
        try { await apiPost('/api/pm2/save', {}); } catch { /* non-fatal */ }
      }

      toast.success({ title: `${appName} started` });
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error({ title: 'Could not start app', description: e.message });
    }
    setCreating(false);
  };

  const segments = browsePath.split('/').filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4">
      <div className="bg-canvas border border-line w-full sm:max-w-2xl h-[94vh] sm:h-auto sm:max-h-[88vh]
                      rounded-t-modal sm:rounded-modal overflow-hidden flex flex-col shadow-2xl animate-slide-up">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 h-14 border-b border-line shrink-0">
          <div className="min-w-0">
            <h3 className="text-body font-semibold text-ink">New application</h3>
            <p className="text-label text-subtle">{STEPS[step - 1]}</p>
          </div>
          <button onClick={onClose} className="btn-icon !w-9 !h-9" aria-label="Close wizard">
            <X className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* Step rail — named, not four anonymous bars. */}
        <ol className="flex items-center gap-1 px-4 sm:px-5 py-2.5 border-b border-line shrink-0">
          {STEPS.map((s, i) => {
            const n = i + 1;
            const done = n < step;
            const active = n === step;
            return (
              <li key={s} className="flex items-center gap-1 min-w-0">
                <button
                  onClick={() => n < step && setStep(n)}
                  disabled={n > step}
                  className={`flex items-center gap-1.5 px-2 h-7 rounded-chip text-label font-medium transition-colors
                    ${active ? 'bg-accent/10 text-accent' : done ? 'text-muted hover:text-ink' : 'text-subtle'}`}
                  aria-current={active ? 'step' : undefined}
                >
                  <span className={`w-4 h-4 rounded-full grid place-items-center text-[10px] shrink-0
                    ${active ? 'bg-accent text-canvas' : done ? 'bg-emerald-400/20 text-emerald-400' : 'bg-raised'}`}>
                    {done ? '✓' : n}
                  </span>
                  <span className="max-sm:sr-only">{s}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-subtle shrink-0" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 sm:p-5">
          {/* ── 1. Folder ─────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-3">
              <nav className="flex items-center gap-0.5 flex-wrap text-meta" aria-label="Breadcrumb">
                <button onClick={() => loadDir('/')} className="px-1 text-muted hover:text-accent transition-colors font-mono">/</button>
                {segments.map((seg, i) => (
                  <span key={i} className="flex items-center gap-0.5 min-w-0">
                    <button
                      onClick={() => loadDir('/' + segments.slice(0, i + 1).join('/'))}
                      className="px-1 text-muted hover:text-accent transition-colors font-mono truncate"
                    >
                      {seg}
                    </button>
                    {i < segments.length - 1 && <span className="text-subtle">/</span>}
                  </span>
                ))}
              </nav>

              <div className="rounded-card border border-line bg-surface overflow-hidden max-h-72 overflow-y-auto">
                {browseData?.parent && browseData.parent !== browseData.path && (
                  <button
                    onClick={() => loadDir(browseData.parent)}
                    className="w-full flex items-center gap-2 px-3 h-10 hover:bg-raised text-meta text-muted border-b border-line transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
                    Up one level
                  </button>
                )}
                {loadingBrowse ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-5 h-5 text-accent animate-spin" aria-hidden="true" />
                  </div>
                ) : !browseData?.dirs.length ? (
                  <p className="text-center py-8 text-meta text-subtle">No subfolders here</p>
                ) : (
                  browseData.dirs.map(dir => {
                    const active = selectedFolder === dir.path;
                    return (
                      <button
                        key={dir.path}
                        onClick={() => {
                          setSelectedFolder(dir.path);
                          setAppName(dir.path.split('/').filter(Boolean).pop() || '');
                          loadDir(dir.path);
                        }}
                        className={`w-full flex items-center gap-2 px-3 h-10 max-md:h-11 text-meta transition-colors border-l-2
                          ${active ? 'border-l-accent bg-accent/[0.07] text-accent' : 'border-l-transparent hover:bg-raised text-muted'}`}
                      >
                        {active
                          ? <FolderOpen className="w-4 h-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                          : <Folder className="w-4 h-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />}
                        <span className="truncate font-mono">{dir.name}</span>
                      </button>
                    );
                  })
                )}
              </div>

              {projectFiles.length > 0 && (
                <div>
                  <p className="eyebrow mb-1.5">Detected project files</p>
                  <div className="flex flex-wrap gap-1.5">
                    {projectFiles.map(f => (
                      <span key={f.path} className="pill pill-neutral font-mono">{f.name}</span>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-meta text-muted">
                Working directory: <span className="font-mono text-ink break-all">{targetDir || '—'}</span>
              </p>
            </div>
          )}

          {/* ── 2. Script ─────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-meta text-muted">
                In <span className="font-mono text-ink break-all">{targetDir}</span>
              </p>

              {projectFiles.length > 0 && (
                <div className="rounded-card border border-line bg-surface overflow-hidden">
                  {projectFiles.map(f => {
                    const active = selectedFile === f.name;
                    return (
                      <button
                        key={f.path}
                        onClick={() => { setSelectedFile(f.name); setManualFile(''); }}
                        className={`w-full flex items-center gap-2 px-3 h-11 text-meta transition-colors border-b border-line/60 last:border-0 border-l-2
                          ${active ? 'border-l-accent bg-accent/[0.07] text-accent' : 'border-l-transparent hover:bg-raised text-muted'}`}
                      >
                        <FileCode className="w-4 h-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                        <span className="font-mono truncate">{f.name}</span>
                        <span className="ml-auto text-label text-subtle uppercase shrink-0">{f.type}</span>
                        {active && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              )}

              <div>
                <label htmlFor="manual-script" className="eyebrow block mb-1.5">Or enter a script or command</label>
                <input
                  id="manual-script"
                  value={manualFile}
                  onChange={e => { setManualFile(e.target.value); setSelectedFile(''); }}
                  placeholder="src/index.js"
                  className="field font-mono max-md:!h-11"
                />
              </div>
            </div>
          )}

          {/* ── 3. Options ────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="app-name" className="eyebrow block mb-1.5">Name</label>
                  <input
                    id="app-name"
                    value={appName}
                    onChange={e => setAppName(e.target.value)}
                    placeholder="my-app"
                    className="field max-md:!h-11"
                  />
                </div>
                <div>
                  <label htmlFor="interp" className="eyebrow block mb-1.5">Interpreter</label>
                  <select
                    id="interp"
                    value={interpreter}
                    onChange={e => setInterpreter(e.target.value)}
                    className="field max-md:!h-11"
                  >
                    <option value="node">Node.js</option>
                    <option value="python3">Python 3</option>
                    <option value="bash">Bash</option>
                    <option value="ruby">Ruby</option>
                    <option value="none">None (binary)</option>
                  </select>
                </div>
              </div>

              <div>
                <p className="eyebrow mb-1.5">Execution mode</p>
                <div className="grid grid-cols-2 gap-2">
                  <ModeBtn active={execMode === 'fork'} onClick={() => setExecMode('fork')}
                           title="Fork" sub="One process" />
                  <ModeBtn active={execMode === 'cluster'} onClick={() => setExecMode('cluster')}
                           title="Cluster" sub="Load-balanced" />
                </div>
              </div>

              {execMode === 'cluster' && (
                <div>
                  <label htmlFor="inst" className="eyebrow block mb-1.5">Instances</label>
                  <input id="inst" value={instances} onChange={e => setInstances(e.target.value)}
                         placeholder="max" className="field max-md:!h-11" />
                </div>
              )}

              <Toggle
                checked={saveForBoot} onChange={setSaveForBoot}
                title="Start on boot"
                sub="Saves the process list so PM2 restores this app after a reboot."
              />
              <Toggle
                checked={autoRestart} onChange={setAutoRestart}
                title="Restart on crash"
                sub="Brings the app back if it exits unexpectedly. Separate from boot."
              />
              <Toggle
                checked={smartRestart} onChange={setSmartRestart}
                title="Smart restart"
                sub="Restart on File Manager edits and Git pulls only — never on writes the app makes itself."
              />
              <Toggle
                checked={watchMode} onChange={setWatchMode}
                title="Watch mode"
                sub="Restart on any file change in the project."
              />

              {watchMode && (
                <div className="space-y-3 pl-3 border-l-2 border-warning/30">
                  <div className="flex items-start gap-2 rounded-card border border-warning/25 bg-warning/5 p-3">
                    <Target className="w-4 h-4 text-warning shrink-0 mt-0.5" strokeWidth={1.5} aria-hidden="true" />
                    <p className="text-meta text-warning/90">
                      Watch mode restarts on <strong>any</strong> file change. If the app writes its own
                      databases, logs or caches it can restart in a loop. Smart restart is usually what you want.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <ModeBtn active={watchType === 'all'} onClick={() => setWatchType('all')}
                             title="Watch all" sub="Except ignored" />
                    <ModeBtn active={watchType === 'only'} onClick={() => setWatchType('only')}
                             title="Watch only" sub="Specific paths" />
                  </div>
                  {watchType === 'all' ? (
                    <div>
                      <label htmlFor="ignore" className="eyebrow block mb-1.5">Additional ignore patterns</label>
                      <input id="ignore" value={ignoreWatch} onChange={e => setIgnoreWatch(e.target.value)}
                             placeholder="data/, *.json" className="field font-mono max-md:!h-11" />
                      <p className="text-label text-subtle mt-1">
                        Already ignored: node_modules, .git, *.db, *.sqlite, *.log, logs
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="only" className="eyebrow block mb-1.5">Watch these paths only</label>
                      <input id="only" value={watchOnly} onChange={e => setWatchOnly(e.target.value)}
                             placeholder="src/, index.js" className="field font-mono max-md:!h-11" />
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="maxmem" className="eyebrow block mb-1.5">Restart above memory</label>
                  <input id="maxmem" value={maxMemRestart} onChange={e => setMaxMemRestart(e.target.value)}
                         placeholder="200M" className="field font-mono max-md:!h-11" />
                </div>
                <div>
                  <label htmlFor="cron" className="eyebrow block mb-1.5">Scheduled restart</label>
                  <input id="cron" value={cronRestart} onChange={e => setCronRestart(e.target.value)}
                         placeholder="0 0 * * *" className="field font-mono max-md:!h-11" />
                </div>
              </div>

              <div>
                <label htmlFor="nodeargs" className="eyebrow block mb-1.5">Node arguments</label>
                <input id="nodeargs" value={nodeArgs} onChange={e => setNodeArgs(e.target.value)}
                       placeholder="--max-old-space-size=4096" className="field font-mono max-md:!h-11" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="eyebrow">Environment variables</p>
                  <button
                    onClick={() => setEnvVars([...envVars, { key: '', value: '' }])}
                    className="btn btn-sm btn-quiet"
                  >
                    <Plus className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" /> Add
                  </button>
                </div>
                {envVars.map((v, i) => (
                  <div key={i} className="flex gap-2 mb-1.5">
                    <input
                      value={v.key}
                      onChange={e => {
                        const next = [...envVars]; next[i] = { ...next[i], key: e.target.value }; setEnvVars(next);
                      }}
                      placeholder="KEY" aria-label={`Variable ${i + 1} name`}
                      className="field flex-1 font-mono !h-9 max-md:!h-11"
                    />
                    <input
                      value={v.value}
                      onChange={e => {
                        const next = [...envVars]; next[i] = { ...next[i], value: e.target.value }; setEnvVars(next);
                      }}
                      placeholder="value" aria-label={`Variable ${i + 1} value`}
                      className="field flex-1 font-mono !h-9 max-md:!h-11"
                    />
                    <button
                      onClick={() => setEnvVars(envVars.filter((_, j) => j !== i))}
                      className="btn-icon !w-9 !h-9 max-md:!w-11 max-md:!h-11 hover:text-danger"
                      aria-label={`Remove variable ${i + 1}`}
                    >
                      <X className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 4. Review ─────────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-3">
              <dl className="rounded-card border border-line bg-surface divide-y divide-line/70">
                <Rev k="Name" v={appName} />
                <Rev k="Script" v={startFile} mono />
                <Rev k="Directory" v={targetDir} mono />
                <Rev k="Interpreter" v={interpreter} />
                <Rev k="Mode" v={execMode === 'cluster' ? `cluster × ${instances}` : 'fork'} />
                <Rev k="On boot" v={saveForBoot ? 'Saved — restored at boot' : 'Not saved'} />
                <Rev k="On crash" v={autoRestart ? 'Restart automatically' : 'Stay down'} />
                {smartRestart && <Rev k="Smart restart" v="Enabled" />}
                {watchMode && <Rev k="Watch" v={watchType === 'all' ? 'All files' : watchOnly || 'Selected paths'} />}
                {maxMemRestart && <Rev k="Memory limit" v={maxMemRestart} mono />}
                {cronRestart && <Rev k="Scheduled restart" v={cronRestart} mono />}
                {nodeArgs && <Rev k="Node args" v={nodeArgs} mono />}
              </dl>

              {envVars.filter(v => v.key).length > 0 && (
                <div className="rounded-card border border-line bg-surface p-3">
                  <p className="eyebrow mb-1.5">Environment</p>
                  {envVars.filter(v => v.key).map((v, i) => (
                    <p key={i} className="text-meta font-mono">
                      <span className="text-accent">{v.key}</span>
                      <span className="text-subtle">=</span>
                      <span className="text-muted">{v.value}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 h-16 border-t border-line shrink-0">
          <button
            onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
            className="btn btn-quiet max-md:!h-11"
          >
            {step > 1 ? 'Back' : 'Cancel'}
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canContinue}
              className="btn btn-primary max-md:!h-11"
            >
              Continue
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : (
            <button
              onClick={create}
              disabled={creating || !appName.trim() || !startFile}
              className="btn btn-primary max-md:!h-11"
            >
              {creating
                ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                : <Zap className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />}
              Start app
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeBtn({ active, onClick, title, sub }: {
  active: boolean; onClick: () => void; title: string; sub: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left px-3 py-2.5 rounded-control border transition-colors
        ${active ? 'border-accent/40 bg-accent/[0.07]' : 'border-line bg-surface hover:border-line-strong'}`}
      aria-pressed={active}
    >
      <span className={`block text-body font-medium ${active ? 'text-accent' : 'text-ink'}`}>{title}</span>
      <span className="block text-label text-subtle mt-0.5">{sub}</span>
    </button>
  );
}

function Toggle({ checked, onChange, title, sub }: {
  checked: boolean; onChange: (v: boolean) => void; title: string; sub: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-card border border-line bg-surface p-3 cursor-pointer hover:border-line-strong transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="accent-accent w-4 h-4 mt-0.5 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-body font-medium text-ink">{title}</span>
        <span className="block text-meta text-muted mt-0.5">{sub}</span>
      </span>
    </label>
  );
}

function Rev({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5">
      <dt className="text-meta text-muted shrink-0">{k}</dt>
      <dd className={`text-meta text-ink text-right break-all ${mono ? 'font-mono' : ''}`}>{v || '—'}</dd>
    </div>
  );
}
