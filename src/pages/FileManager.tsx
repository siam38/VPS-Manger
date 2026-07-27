import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import {
  ArrowLeft, ArrowUpDown, ChevronDown, ChevronRight, ClipboardPaste, Copy,
  CornerDownRight, Download, Edit2, Eye, EyeOff, FilePlus, FolderPlus, Grid3x3,
  Home, List, MoreHorizontal, PencilLine, Plus, RefreshCw, Scissors, Search,
  Trash2, Upload, X, Zap,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete, downloadFile, uploadFiles } from '../lib/api';
import { classifyFile, isEditable, KIND_LABEL } from '../lib/fileTypes';
import { useToast } from '../lib/toast';
import { FileRow, EmptyState, type FileItem } from '../components/files/FileRow';
import { getPlatform, type PlatformInfo } from '../lib/platform';

// The editor pulls in CodeMirror and a grammar; the preview pulls in nothing
// heavy but is still dead weight while you are only browsing. Both are split
// out so opening a folder does not download an editor you may never use.
const FileEditor = lazy(() => import('../components/FileEditor'));
const FilePreview = lazy(() => import('../components/FilePreview'));

function OverlayFallback() {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-canvas">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

interface OpenclawDir {
  path: string;
  workspace: string | null;
  markers: string[];
  entries: number;
  stub: boolean;
}

type SortKey = 'name' | 'size' | 'modified' | 'type';
type SortDir = 'asc' | 'desc';
type ViewMode = 'list' | 'grid';

// Allowed bases now come from the server's runtime detection rather than a
// duplicated literal list. A Debian host's /home/debian is reachable without
// editing source, and the two copies can no longer drift apart.
function baseOf(p: string, bases: string[], fallback: string) {
  const match = bases
    .filter(b => p === b || p.startsWith(b.endsWith('/') ? b : b + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return match || fallback;
}

function parentOf(p: string, bases: string[], fallback: string) {
  const up = p.substring(0, p.lastIndexOf('/'));
  return up || baseOf(p, bases, fallback);
}

export default function FileManager() {
  const toast = useToast();

  // Host layout comes from the server. Until it lands we have no honest
  // default, so start empty and navigate once detection resolves.
  const [plat, setPlat] = useState<PlatformInfo | null>(null);
  const bases = plat?.allowedBases ?? [];
  const homePath = plat?.defaultPath ?? '';

  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showHidden, setShowHidden] = useState(
    () => localStorage.getItem('vps_show_hidden') === 'true'
  );
  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem('vps_files_view') as ViewMode) || 'list'
  );
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<{ items: string[]; mode: 'copy' | 'cut' } | null>(null);

  const [menu, setMenu] = useState<{ item: FileItem; x: number; y: number } | null>(null);
  const [overflow, setOverflow] = useState(false);

  // Windows-style editable address bar. The breadcrumb is the default view;
  // clicking it (or Ctrl+L) swaps in a real input you can paste a path into.
  const [editingPath, setEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState('');
  const pathInputRef = useRef<HTMLInputElement>(null);

  // OpenClaw workspaces are detected server-side, not hard-coded — the agent
  // does not always live under /home/ubuntu.
  const [ocDirs, setOcDirs] = useState<OpenclawDir[] | null>(null);
  const [ocOpen, setOcOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [createName, setCreateName] = useState('');
  const [renaming, setRenaming] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [editing, setEditing] = useState<FileItem | null>(null);
  const [previewing, setPreviewing] = useState<FileItem | null>(null);

  const [dragOver, setDragOver] = useState(false);
  const [upload, setUpload] = useState<{ percent: number; label: string } | null>(null);

  const [history, setHistory] = useState<string[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastIndexRef = useRef<number | null>(null);

  useEffect(() => { localStorage.setItem('vps_show_hidden', String(showHidden)); }, [showHidden]);
  useEffect(() => { localStorage.setItem('vps_files_view', view); }, [view]);

  // ── Load ──────────────────────────────────────────────────────────
  const load = useCallback(async (target?: string) => {
    const p = target ?? currentPath;
    if (!p) return; // platform not resolved yet
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ path: string; items: FileItem[] }>(
        `/api/files/list?path=${encodeURIComponent(p)}&hidden=${showHidden}`
      );
      setItems(data.items);
      setCurrentPath(data.path);
      setSelected(new Set());
      lastIndexRef.current = null;
    } catch (e: any) {
      setError(e.message || 'Could not read this folder');
    } finally {
      setLoading(false);
    }
  }, [currentPath, showHidden]);

  // Resolve the host layout once, then open at its real default path.
  // Previously this opened at a literal '/root', which is the wrong place on
  // any VPS where projects live in a user home.
  useEffect(() => {
    let alive = true;
    getPlatform().then(info => {
      if (!alive) return;
      setPlat(info);
      setCurrentPath(cur => cur || info.defaultPath);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [showHidden, plat]);

  const navigate = useCallback((p: string) => {
    setHistory(h => [...h, currentPath].slice(-50));
    setSearch('');
    load(p);
  }, [currentPath, load]);

  const goBack = useCallback(() => {
    setHistory(h => {
      if (!h.length) { load(parentOf(currentPath, bases, homePath)); return h; }
      const prev = h[h.length - 1];
      load(prev);
      return h.slice(0, -1);
    });
  }, [currentPath, load]);

  // ── Sorting + filtering ───────────────────────────────────────────
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? items.filter(i => i.name.toLowerCase().includes(term))
      : items;

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // Folders always lead, regardless of sort column.
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      switch (sortKey) {
        case 'size': return (a.size - b.size) * dir;
        case 'modified':
          return (new Date(a.modified).getTime() - new Date(b.modified).getTime()) * dir;
        case 'type': {
          const at = a.isDirectory ? 'folder' : classifyFile(a.name);
          const bt = b.isDirectory ? 'folder' : classifyFile(b.name);
          return at === bt ? a.name.localeCompare(b.name) : at.localeCompare(bt) * dir;
        }
        default:
          return a.name.localeCompare(b.name, undefined, { numeric: true }) * dir;
      }
    });
  }, [items, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  // ── Selection ─────────────────────────────────────────────────────
  const toggleSelect = useCallback((item: FileItem, e: any) => {
    const index = visible.findIndex(i => i.path === item.path);
    setSelected(prev => {
      const next = new Set(prev);
      // Shift-click selects the range, like every real file manager.
      if (e?.shiftKey && lastIndexRef.current !== null) {
        const [from, to] = [lastIndexRef.current, index].sort((a, b) => a - b);
        for (let i = from; i <= to; i++) next.add(visible[i].path);
      } else if (next.has(item.path)) {
        next.delete(item.path);
      } else {
        next.add(item.path);
      }
      return next;
    });
    lastIndexRef.current = index;
  }, [visible]);

  const allSelected = visible.length > 0 && visible.every(i => selected.has(i.path));

  // ── Open ──────────────────────────────────────────────────────────
  const open = useCallback((item: FileItem) => {
    if (item.isDirectory) { navigate(item.path); return; }
    if (isEditable(item.name)) { setEditing(item); return; }
    setPreviewing(item);
  }, [navigate]);

  // ── Mutations ─────────────────────────────────────────────────────
  const remove = useCallback(async (paths: string[]) => {
    const many = paths.length > 1;
    const label = many ? `${paths.length} items` : paths[0].split('/').pop();
    const ok = await toast.confirm({
      title: many ? `Delete ${paths.length} items?` : `Delete ${label}?`,
      description: 'This removes them from disk immediately. There is no recycle bin.',
      confirmLabel: 'Delete',
      danger: true,
      requireText: paths.length > 3 ? 'delete' : undefined,
    });
    if (!ok) return;

    const id = toast.loading({ title: `Deleting ${label}…` });
    const failed: string[] = [];
    for (const p of paths) {
      try { await apiDelete('/api/files/delete', { path: p }); }
      catch { failed.push(p.split('/').pop() || p); }
    }
    if (failed.length) {
      toast.update(id, 'error', {
        title: `Failed to delete ${failed.length} item(s)`,
        description: failed.slice(0, 4).join(', '),
      });
    } else {
      toast.update(id, 'success', { title: `Deleted ${label}`, duration: 2500 });
    }
    load();
  }, [toast, load]);

  const create = useCallback(async () => {
    const name = createName.trim();
    if (!name) { setCreating(null); return; }
    if (name.includes('/')) {
      toast.error({ title: 'Invalid name', description: 'Names cannot contain "/".' });
      return;
    }
    if (items.some(i => i.name === name)) {
      toast.error({ title: 'Already exists', description: `"${name}" is already in this folder.` });
      return;
    }
    try {
      if (creating === 'folder') {
        await apiPost('/api/files/mkdir', { path: currentPath, name });
        toast.success({ title: 'Folder created', description: name, duration: 2000 });
      } else {
        await apiPost('/api/files/save', { path: `${currentPath}/${name}`, content: '' });
        toast.success({ title: 'File created', description: name, duration: 2000 });
      }
      setCreating(null);
      setCreateName('');
      load();
    } catch (e: any) {
      toast.error({ title: 'Could not create', description: e.message });
    }
  }, [createName, creating, currentPath, items, toast, load]);

  const rename = useCallback(async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name || name === renaming.name) { setRenaming(null); return; }
    try {
      const dir = renaming.path.substring(0, renaming.path.lastIndexOf('/'));
      await apiPost('/api/files/rename', { oldPath: renaming.path, newPath: `${dir}/${name}` });
      toast.success({ title: 'Renamed', description: `${renaming.name} → ${name}`, duration: 2500 });
      setRenaming(null);
      load();
    } catch (e: any) {
      toast.error({ title: 'Rename failed', description: e.message });
    }
  }, [renaming, renameValue, toast, load]);

  const paste = useCallback(async () => {
    if (!clipboard) return;
    const id = toast.loading({
      title: `${clipboard.mode === 'copy' ? 'Copying' : 'Moving'} ${clipboard.items.length} item(s)…`,
    });
    const failed: string[] = [];
    for (const src of clipboard.items) {
      const name = src.split('/').pop();
      const dest = `${currentPath}/${name}`;
      if (src === dest) continue;
      try {
        if (clipboard.mode === 'copy') {
          await apiPost('/api/files/copy', { sourcePath: src, destPath: dest });
        } else {
          await apiPost('/api/files/rename', { oldPath: src, newPath: dest });
        }
      } catch { failed.push(name || src); }
    }
    if (failed.length) {
      toast.update(id, 'error', {
        title: `${failed.length} item(s) failed`,
        description: failed.slice(0, 4).join(', '),
      });
    } else {
      toast.update(id, 'success', { title: 'Done', duration: 2000 });
    }
    if (clipboard.mode === 'cut') setClipboard(null);
    load();
  }, [clipboard, currentPath, toast, load]);

  const doUpload = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const label = files.length === 1 ? files[0].name : `${files.length} files`;
    setUpload({ percent: 0, label });
    const { promise } = uploadFiles(currentPath, files, p => {
      setUpload({ percent: p, label });
    });
    try {
      await promise;
      toast.success({ title: 'Uploaded', description: label, duration: 2500 });
      load();
    } catch (e: any) {
      toast.error({ title: 'Upload failed', description: e.message });
    } finally {
      setUpload(null);
    }
  }, [currentPath, toast, load]);

  const download = useCallback((item: FileItem) => {
    const id = toast.loading({
      title: `Preparing ${item.name}${item.isDirectory ? ' (zip)' : ''}…`,
    });
    downloadFile(item.path)
      .then(() => toast.update(id, 'success', { title: `Downloaded ${item.name}`, duration: 2500 }))
      .catch(e => toast.update(id, 'error', { title: 'Download failed', description: e.message }));
  }, [toast]);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || previewing) return;
      const el = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || '');

      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'Escape') {
        if (search) setSearch('');
        else if (selected.size) setSelected(new Set());
        return;
      }
      if (typing) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'a') {
        e.preventDefault();
        setSelected(new Set(visible.map(i => i.path)));
      } else if (mod && e.key === 'c' && selected.size) {
        setClipboard({ items: [...selected], mode: 'copy' });
        toast.info({ title: `Copied ${selected.size} item(s)`, duration: 1800 });
      } else if (mod && e.key === 'x' && selected.size) {
        setClipboard({ items: [...selected], mode: 'cut' });
        toast.info({ title: `Cut ${selected.size} item(s)`, duration: 1800 });
      } else if (mod && e.key === 'v' && clipboard) {
        paste();
      } else if (e.key === 'Delete' && selected.size) {
        remove([...selected]);
      } else if (e.key === 'Backspace') {
        goBack();
      } else if (e.key === 'F5' || (mod && e.key === 'r')) {
        e.preventDefault(); load();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, previewing, search, selected, visible, clipboard, paste, remove, goBack, load, toast]);

  const inOpenclaw = !!ocDirs?.some(d => currentPath.startsWith(d.path));
  const parts = currentPath.split('/').filter(Boolean);

  // Detect OpenClaw workspaces once per session.
  useEffect(() => {
    apiGet<{ dirs: OpenclawDir[] }>('/api/files/openclaw')
      .then(d => setOcDirs(d.dirs || []))
      .catch(() => setOcDirs([]));
  }, []);

  const beginEditPath = useCallback(() => {
    setPathDraft(currentPath);
    setEditingPath(true);
    requestAnimationFrame(() => {
      pathInputRef.current?.focus();
      pathInputRef.current?.select();
    });
  }, [currentPath]);

  const commitPath = useCallback(() => {
    const raw = pathDraft.trim();
    setEditingPath(false);
    if (!raw || raw === currentPath) return;
    // Accept pasted paths with a trailing slash or stray whitespace.
    const clean = raw.replace(/\/+$/, '') || '/';
    navigate(clean);
  }, [pathDraft, currentPath, navigate]);

  const openOpenclaw = useCallback((dir: OpenclawDir) => {
    setShowHidden(true);
    navigate(dir.workspace || dir.path);
    setOcOpen(false);
    setOverflow(false);
  }, [navigate]);

  return (
    <div
      className="flex flex-col min-h-0 h-full max-lg:h-[calc(100dvh-3.5rem)]"
      onClick={() => { setMenu(null); setOverflow(false); setNewOpen(false); setSortOpen(false); setJumpOpen(false); setOcOpen(false); }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={e => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={e => {
        e.preventDefault();
        setDragOver(false);
        doUpload(Array.from(e.dataTransfer.files));
      }}
    >
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-line bg-surface/40">
        {/* Row 1: navigation + search */}
        <div className="flex items-center gap-1.5 px-2 sm:px-3 h-12">
          <button className="btn-icon !w-8 !h-8 max-md:!w-10 max-md:!h-10" onClick={goBack} aria-label="Go back">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            className="btn-icon !w-8 !h-8 max-md:!w-10 max-md:!h-10"
            onClick={() => navigate(baseOf(currentPath, bases, homePath))}
            aria-label="Go to base folder"
          >
            <Home className="w-4 h-4" aria-hidden="true" />
          </button>

          {/* Address bar.
           *
           * Breadcrumb by default; click it (or Ctrl+L) to get a real editable
           * path input you can paste into, Windows Explorer style. */}
          {editingPath ? (
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <input
                ref={pathInputRef}
                value={pathDraft}
                onChange={e => setPathDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitPath(); }
                  if (e.key === 'Escape') { e.preventDefault(); setEditingPath(false); }
                }}
                onBlur={commitPath}
                spellCheck={false}
                autoComplete="off"
                aria-label="Folder path"
                placeholder="/var/www/example.com"
                className="field !h-9 font-mono text-meta flex-1 min-w-0"
              />
              <button
                className="btn-icon !w-8 !h-8 shrink-0"
                onMouseDown={e => e.preventDefault()}
                onClick={() => setEditingPath(false)}
                aria-label="Cancel path edit"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
          <nav
            aria-label="Breadcrumb"
            className="group flex-1 min-w-0 flex items-center justify-end sm:justify-start gap-0.5
                       overflow-x-auto scrollbar-none mask-fade-l sm:[mask-image:none]
                       rounded-control hover:bg-raised/50 transition-colors"
            onDoubleClick={beginEditPath}
          >
            <span className="flex items-center gap-0.5 shrink-0">
              {/* Explicit filesystem root, so a one-segment path like /root
                  reads as a path and not as a bare word (or a username). */}
              <button
                onClick={() => navigate('/')}
                aria-label="Filesystem root"
                className="px-1.5 h-8 rounded-control text-body text-muted font-mono
                           hover:text-ink hover:bg-raised transition-colors shrink-0"
              >
                /
              </button>
              {parts.map((part, i) => {
                const target = '/' + parts.slice(0, i + 1).join('/');
                const last = i === parts.length - 1;
                return (
                  <React.Fragment key={target}>
                    {i > 0 && <ChevronRight className="w-3 h-3 text-subtle shrink-0" aria-hidden="true" />}
                    <button
                      onClick={() => !last && navigate(target)}
                      disabled={last}
                      aria-current={last ? 'page' : undefined}
                      className={`px-1.5 h-8 rounded-control whitespace-nowrap transition-colors
                                  ${last
                                    ? 'text-body text-ink font-semibold cursor-default'
                                    : 'text-meta text-muted underline decoration-line-strong decoration-dotted underline-offset-4 hover:text-accent hover:decoration-accent hover:bg-raised'}`}
                    >
                      {part}
                    </button>
                  </React.Fragment>
                );
              })}
            </span>

            <button
              onClick={beginEditPath}
              aria-label="Edit path"
              title="Edit path (Ctrl+L)"
              className="ml-1 shrink-0 px-1.5 h-7 rounded-control text-label text-subtle
                         hover:text-accent hover:bg-raised transition-colors
                         md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
            >
              <PencilLine className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </nav>
          )}

          <div className="relative hidden sm:block">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" aria-hidden="true" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter…  /"
              aria-label="Filter files in this folder"
              className="field !h-8 !w-44 lg:!w-56 !pl-8 !pr-7"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear filter"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            className="btn-icon !w-8 !h-8 max-md:!w-10 max-md:!h-10"
            onClick={() => load()}
            aria-label="Refresh folder"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>

        {/* Row 2: actions.
         *
         * Desktop keeps one chip treatment across the whole row. Mobile shows
         * only New / Upload and folds the six secondary toggles into an
         * overflow sheet — six unlabelled icons in a row was unreadable, and
         * the targets were under the 44px floor.
         */}
        <div className="flex items-center gap-1.5 px-2 sm:px-3 h-14 sm:h-11 border-t border-line/60 min-w-0">
          {/* Actions cluster. One filled primary (Upload) and a single New
           * split button. Previously "New folder" and "New file" each burned
           * a top-level slot on the same verb, and every control had equal
           * weight — so nothing read as primary. */}
          <div className="relative shrink-0">
            <button
              className="btn btn-quiet btn-sm max-sm:!h-10 max-sm:!px-2.5"
              onClick={e => { e.stopPropagation(); setNewOpen(o => !o); setSortOpen(false); setJumpOpen(false); setOcOpen(false); }}
              aria-expanded={newOpen}
              aria-haspopup="menu"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>New</span>
              <ChevronDown className="w-3 h-3 opacity-50" aria-hidden="true" />
            </button>
            {newOpen && (
              <div
                className="absolute left-0 top-10 z-40 w-44 card shadow-2xl py-1 animate-slide-up"
                onClick={e => e.stopPropagation()}
                role="menu"
              >
                <SheetItem
                  icon={FolderPlus}
                  label="Folder"
                  onClick={() => { setCreating('folder'); setCreateName(''); setNewOpen(false); }}
                />
                <SheetItem
                  icon={FilePlus}
                  label="File"
                  onClick={() => { setCreating('file'); setCreateName(''); setNewOpen(false); }}
                />
              </div>
            )}
          </div>

          <button
            className="btn btn-primary btn-sm shrink-0 max-sm:!h-10 max-sm:!px-2.5"
            onClick={() => uploadRef.current?.click()}
          >
            <Upload className="w-4 h-4" aria-hidden="true" />
            <span>Upload</span>
          </button>

          {clipboard && (
            <button
              className="btn btn-quiet btn-sm shrink-0 max-sm:!h-10 max-sm:!px-2.5"
              onClick={paste}
            >
              <ClipboardPaste className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Paste ({clipboard.items.length})</span>
              <span className="sm:hidden">{clipboard.items.length}</span>
            </button>
          )}

          {/* Secondary controls: view state, visually distinct from actions.
           * These were text buttons identical in weight to New/Upload, so
           * actions and state read as the same thing. Now: segmented view
           * control, icon toggle, and a value-only sort dropdown. */}
          <span className="hidden sm:flex items-center gap-1.5">
            <span className="w-px h-5 bg-line mx-1.5" aria-hidden="true" />

            <span
              className="inline-flex items-center p-0.5 rounded-control bg-raised/70 border border-line/70"
              role="group"
              aria-label="View mode"
            >
              {(['list', 'grid'] as ViewMode[]).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  aria-label={`${v} view`}
                  title={`${v} view`}
                  className={`w-7 h-7 rounded-chip flex items-center justify-center transition-colors
                              ${view === v
                                ? 'bg-accent/15 text-accent'
                                : 'text-muted hover:text-ink'}`}
                >
                  {v === 'list'
                    ? <List className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
                    : <Grid3x3 className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />}
                </button>
              ))}
            </span>

            <button
              className={`btn btn-sm !font-normal ${showHidden
                            ? '!text-accent !bg-accent/10 !border-accent/30'
                            : 'btn-quiet'}`}
              onClick={() => setShowHidden(h => !h)}
              aria-pressed={showHidden}
              aria-label={showHidden ? 'Hide hidden files' : 'Show hidden files'}
              title={showHidden ? 'Hidden files are shown' : 'Hidden files are not shown'}
            >
              {showHidden
                ? <Eye className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
                : <EyeOff className="w-4 h-4 text-muted" strokeWidth={1.5} aria-hidden="true" />}
              <span className="hidden lg:inline">Hidden</span>
            </button>

            <div className="relative">
              <button
                className="btn btn-quiet btn-sm !font-normal"
                onClick={e => { e.stopPropagation(); setSortOpen(o => !o); setNewOpen(false); setJumpOpen(false); setOcOpen(false); }}
                aria-expanded={sortOpen}
                aria-haspopup="menu"
                title="Sort order"
              >
                <ArrowUpDown className="w-4 h-4 text-muted" strokeWidth={1.5} aria-hidden="true" />
                <span className="hidden lg:inline capitalize">
                  {sortKey} {sortDir === 'asc' ? '↑' : '↓'}
                </span>
              </button>
              {sortOpen && (
                <div
                  className="absolute right-0 top-10 z-40 w-44 card shadow-2xl py-1 animate-slide-up"
                  onClick={e => e.stopPropagation()}
                  role="menu"
                >
                  {(['name', 'size', 'modified', 'type'] as SortKey[]).map(k => (
                    <SheetItem
                      key={k}
                      icon={ArrowUpDown}
                      active={sortKey === k}
                      label={`${k[0].toUpperCase()}${k.slice(1)}${sortKey === k ? (sortDir === 'asc' ? '  ↑' : '  ↓') : ''}`}
                      onClick={() => { toggleSort(k); setSortOpen(false); }}
                    />
                  ))}
                </div>
              )}
            </div>

            <span className="w-px h-5 bg-line mx-1.5" aria-hidden="true" />

            {/* Jump to — desktop equivalent of the mobile sheet's base picker.
                This was missing entirely on desktop. */}
            <div className="relative">
              <button
                className="btn btn-quiet btn-sm !font-normal"
                onClick={e => { e.stopPropagation(); setJumpOpen(o => !o); setOcOpen(false); setSortOpen(false); setNewOpen(false); }}
                aria-expanded={jumpOpen}
                aria-haspopup="menu"
              >
                <CornerDownRight className="w-4 h-4 text-muted" strokeWidth={1.5} aria-hidden="true" />
                <span className="hidden lg:inline">Jump to</span>
                <ChevronDown className="w-3 h-3 opacity-50" aria-hidden="true" />
              </button>

              {jumpOpen && (
                <div
                  className="absolute left-0 top-10 z-40 w-52 card shadow-2xl py-1 animate-slide-up"
                  onClick={e => e.stopPropagation()}
                  role="menu"
                >
                  <p className="px-3 py-1.5 eyebrow border-b border-line mb-1">Base folders</p>
                  {bases.map(b => (
                    <SheetItem
                      key={b}
                      icon={FolderPlus}
                      label={b}
                      mono
                      active={baseOf(currentPath, bases, homePath) === b}
                      onClick={() => { navigate(b); setJumpOpen(false); }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* OpenClaw — detected, not hard-coded. One install goes straight
                there; several give a picker. */}
            <div className="relative">
              <button
                className={`btn btn-sm !font-normal ${inOpenclaw ? '!text-accent !bg-accent/10' : 'btn-quiet'}`}
                title="Open a detected OpenClaw agent workspace"
                disabled={ocDirs !== null && ocDirs.length === 0}
                onClick={e => {
                  e.stopPropagation();
                  if (!ocDirs?.length) return;
                  if (ocDirs.length === 1) openOpenclaw(ocDirs[0]);
                  else { setOcOpen(o => !o); setJumpOpen(false); setSortOpen(false); setNewOpen(false); }
                }}
                aria-expanded={ocOpen}
              >
                <Zap className={`w-4 h-4 ${inOpenclaw ? '' : 'text-muted'}`} strokeWidth={1.5} aria-hidden="true" />
                <span className="hidden lg:inline">
                  {ocDirs === null ? 'Workspace…' : ocDirs.length === 0 ? 'No workspace' : 'AI workspace'}
                </span>
                {!!ocDirs && ocDirs.length > 1 && (
                  <ChevronDown className="w-3 h-3 opacity-50" aria-hidden="true" />
                )}
              </button>

              {ocOpen && !!ocDirs?.length && (
                <div
                  className="absolute right-0 top-10 z-40 w-72 card shadow-2xl py-1 animate-slide-up"
                  onClick={e => e.stopPropagation()}
                  role="menu"
                >
                  <p className="px-3 py-1.5 eyebrow border-b border-line mb-1">
                    Detected workspaces
                  </p>
                  {ocDirs.map(d => (
                    <button
                      key={d.path}
                      role="menuitem"
                      onClick={() => openOpenclaw(d)}
                      className="w-full text-left px-3 py-2 hover:bg-raised transition-colors"
                    >
                      <span className="block text-meta text-ink font-mono truncate">
                        {d.workspace || d.path}
                      </span>
                      <span className="block text-label text-muted mt-0.5">
                        {d.stub
                          ? 'state only · no workspace'
                          : `${d.markers.slice(0, 3).join(', ')} · ${d.entries} entries`}
                      </span>
                    </button>
                  ))}
                  {inOpenclaw && (
                    <>
                      <div className="border-t border-line my-1" />
                      <SheetItem
                        icon={ArrowLeft}
                        label="Leave workspace"
                        onClick={() => { navigate('/home'); setOcOpen(false); }}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          </span>

          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {selected.size > 0 && (
              <>
                <span className="text-meta text-muted hidden md:inline">
                  {selected.size} selected
                </span>
                <button
                  className="btn btn-quiet btn-sm"
                  onClick={() => setClipboard({ items: [...selected], mode: 'copy' })}
                  aria-label="Copy selected"
                >
                  <Copy className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  className="btn btn-quiet btn-sm"
                  onClick={() => setClipboard({ items: [...selected], mode: 'cut' })}
                  aria-label="Cut selected"
                >
                  <Scissors className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => remove([...selected])}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              </>
            )}

            {/* Mobile overflow */}
            <div className="sm:hidden relative">
              <button
                className="btn btn-quiet btn-sm !h-11 !px-3"
                onClick={e => { e.stopPropagation(); setOverflow(o => !o); }}
                aria-label="More options"
                aria-expanded={overflow}
              >
                <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
              </button>

              {overflow && (
                <div
                  className="absolute right-0 top-12 z-40 w-56 card shadow-2xl py-1 animate-slide-up"
                  onClick={e => e.stopPropagation()}
                  role="menu"
                >
                  <SheetItem
                    icon={FilePlus}
                    label="New file"
                    onClick={() => { setCreating('file'); setCreateName(''); setOverflow(false); }}
                  />
                  <SheetItem
                    icon={showHidden ? Eye : EyeOff}
                    label={showHidden ? 'Hide hidden files' : 'Show hidden files'}
                    onClick={() => { setShowHidden(h => !h); setOverflow(false); }}
                  />
                  <SheetItem
                    icon={view === 'list' ? Grid3x3 : List}
                    label={view === 'list' ? 'Grid view' : 'List view'}
                    onClick={() => { setView(v => (v === 'list' ? 'grid' : 'list')); setOverflow(false); }}
                  />
                  <SheetItem
                    icon={ArrowUpDown}
                    label={`Sort: ${sortKey} (${sortDir})`}
                    onClick={() => { toggleSort(sortKey === 'name' ? 'modified' : 'name'); setOverflow(false); }}
                  />
                  <div className="border-t border-line my-1" />
                  {ocDirs === null ? (
                    <p className="px-3 py-2 text-meta text-muted">Looking for OpenClaw…</p>
                  ) : ocDirs.length === 0 ? (
                    <p className="px-3 py-2 text-meta text-muted">No OpenClaw install found</p>
                  ) : inOpenclaw ? (
                    <SheetItem
                      icon={ArrowLeft}
                      label="Leave workspace"
                      onClick={() => { navigate('/home'); setOverflow(false); }}
                    />
                  ) : (
                    ocDirs.map(d => (
                      <SheetItem
                        key={d.path}
                        icon={Zap}
                        mono
                        label={d.stub ? `${d.path} (state only)` : (d.workspace || d.path)}
                        onClick={() => openOpenclaw(d)}
                      />
                    ))
                  )}
                  <div className="px-3 py-2">
                    <label htmlFor="base-jump" className="eyebrow block mb-1.5">Jump to</label>
                    <select
                      id="base-jump"
                      value={baseOf(currentPath, bases, homePath)}
                      onChange={e => { navigate(e.target.value); setOverflow(false); }}
                      className="field !h-10"
                    >
                      {bases.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile filter */}
        <div className="sm:hidden px-2 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" aria-hidden="true" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter this folder…"
              aria-label="Filter files in this folder"
              className="field !h-11 !pl-8"
            />
          </div>
        </div>

        {/* Inline create */}
        {creating && (
          <div className="flex items-center gap-2 px-3 py-2 border-t border-line bg-raised">
            {creating === 'folder'
              ? <FolderPlus className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
              : <FilePlus className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />}
            <input
              autoFocus
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') create();
                if (e.key === 'Escape') { setCreating(null); setCreateName(''); }
              }}
              placeholder={creating === 'folder' ? 'Folder name' : 'File name, e.g. notes.md'}
              aria-label={creating === 'folder' ? 'New folder name' : 'New file name'}
              className="field flex-1"
            />
            <button className="btn btn-primary btn-sm" onClick={create}>Create</button>
            <button className="btn btn-quiet btn-sm" onClick={() => { setCreating(null); setCreateName(''); }}>
              Cancel
            </button>
          </div>
        )}

        {/* Upload progress */}
        {upload && (
          <div className="px-3 py-2 border-t border-line bg-raised">
            <div className="flex items-center justify-between text-meta text-muted mb-1.5">
              <span className="truncate">Uploading {upload.label}</span>
              <span className="tabular">{upload.percent}%</span>
            </div>
            <div className="h-1 rounded-full bg-line overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-150"
                style={{ width: `${upload.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Column headers (list view, desktop) ─────────────────── */}
      {view === 'list' && visible.length > 0 && (
        <div className="hidden sm:grid shrink-0 grid-cols-[24px_1fr_auto_auto_auto_32px] items-center gap-3
                        px-2 sm:px-3 h-7 border-b border-line bg-surface/60 text-label text-muted">
          <span
            role="checkbox"
            aria-checked={allSelected}
            tabIndex={0}
            onClick={() =>
              setSelected(allSelected ? new Set() : new Set(visible.map(i => i.path)))
            }
            className={`w-4 h-4 mx-auto rounded-chip border cursor-pointer flex items-center justify-center
                        ${allSelected ? 'bg-accent border-accent' : 'border-line-strong'}`}
          >
            {allSelected && <span className="text-canvas text-[10px] leading-none">✓</span>}
          </span>
          <SortHeader label="Name" active={sortKey === 'name'} dir={sortDir} onClick={() => toggleSort('name')} />
          <span className="hidden xl:block w-14 text-right">
            <SortHeader label="Type" align="right" active={sortKey === 'type'} dir={sortDir} onClick={() => toggleSort('type')} />
          </span>
          <SortHeader label="Size" align="right" width="w-20" active={sortKey === 'size'} dir={sortDir} onClick={() => toggleSort('size')} />
          <span className="hidden lg:block w-28 text-right">
            <SortHeader label="Modified" align="right" active={sortKey === 'modified'} dir={sortDir} onClick={() => toggleSort('modified')} />
          </span>
          <span />
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto relative">
        {loading && items.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="empty h-full justify-center">
            <X className="w-10 h-10 text-danger mb-2" aria-hidden="true" />
            <p className="empty-title">Could not read this folder</p>
            <p className="empty-sub">{error}</p>
            <div className="flex gap-2 mt-4">
              <button className="btn btn-primary" onClick={() => load()}>Retry</button>
              <button className="btn btn-quiet" onClick={() => navigate(homePath)}>Go to {homePath || 'home'}</button>
            </div>
          </div>
        )}

        {!error && !loading && visible.length === 0 && (
          <EmptyState
            searching={!!search.trim()}
            onNewFile={() => { setCreating('file'); setCreateName(''); }}
            onNewFolder={() => { setCreating('folder'); setCreateName(''); }}
            onUpload={() => uploadRef.current?.click()}
          />
        )}

        {!error && visible.length > 0 && (
          view === 'grid' ? (
            <div className="grid gap-2 p-3
                            grid-cols-[repeat(auto-fill,minmax(104px,1fr))]">
              {visible.map(item =>
                renaming?.path === item.path ? (
                  <RenameBox
                    key={item.path}
                    value={renameValue}
                    onChange={setRenameValue}
                    onCommit={rename}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <FileRow
                    key={item.path}
                    item={item}
                    view="grid"
                    selected={selected.has(item.path)}
                    cut={clipboard?.mode === 'cut' && clipboard.items.includes(item.path)}
                    onOpen={open}
                    onToggle={toggleSelect}
                    onMenu={(it, x, y) => setMenu({ item: it, x, y })}
                  />
                )
              )}
            </div>
          ) : (
            <div role="table" aria-label="Files">
              {visible.map(item =>
                renaming?.path === item.path ? (
                  <RenameBox
                    key={item.path}
                    row
                    value={renameValue}
                    onChange={setRenameValue}
                    onCommit={rename}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <FileRow
                    key={item.path}
                    item={item}
                    view="list"
                    selected={selected.has(item.path)}
                    cut={clipboard?.mode === 'cut' && clipboard.items.includes(item.path)}
                    onOpen={open}
                    onToggle={toggleSelect}
                    onMenu={(it, x, y) => setMenu({ item: it, x, y })}
                  />
                )
              )}
            </div>
          )
        )}

        {dragOver && (
          <div className="absolute inset-0 z-30 flex items-center justify-center
                          bg-canvas/80 border-2 border-dashed border-accent rounded-card m-2 pointer-events-none">
            <div className="text-center">
              <Upload className="w-8 h-8 text-accent mx-auto mb-2" aria-hidden="true" />
              <p className="text-body text-ink font-medium">Drop to upload</p>
              <p className="text-meta text-muted">into {currentPath}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Status bar ──────────────────────────────────────────── */}
      <footer className="shrink-0 flex items-center justify-between gap-3 px-3 h-8
                         border-t border-line bg-surface text-label text-muted">
        <span className="truncate">
          {visible.length} item{visible.length === 1 ? '' : 's'}
          {search.trim() && ` of ${items.length}`}
          {selected.size > 0 && ` · ${selected.size} selected`}
        </span>
        <span className="hidden sm:inline shrink-0">
          {visible.length > 0 ? 'Enter opens · / filters · Del removes' : ''}
        </span>
      </footer>

      <input
        ref={uploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          doUpload(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />

      {/* ── Context menu ────────────────────────────────────────── */}
      {menu && (
        <div
          className="fixed z-[100] w-44 card shadow-2xl py-1 animate-slide-up"
          style={{
            top: Math.min(menu.y, window.innerHeight - 280),
            left: Math.min(menu.x, window.innerWidth - 190),
          }}
          onClick={e => e.stopPropagation()}
          role="menu"
        >
          <p className="px-3 py-1.5 text-label text-muted truncate border-b border-line mb-1">
            {menu.item.isDirectory ? 'Folder' : KIND_LABEL[classifyFile(menu.item.name)]}
          </p>
          {!menu.item.isDirectory && isEditable(menu.item.name) && (
            <MenuItem label="Edit" onClick={() => { setEditing(menu.item); setMenu(null); }} />
          )}
          {!menu.item.isDirectory && !isEditable(menu.item.name) && (
            <MenuItem label="Preview" onClick={() => { setPreviewing(menu.item); setMenu(null); }} />
          )}
          <MenuItem
            icon={Download}
            label={menu.item.isDirectory ? 'Download as zip' : 'Download'}
            onClick={() => { download(menu.item); setMenu(null); }}
          />
          <MenuItem
            icon={Edit2}
            label="Rename"
            onClick={() => { setRenaming(menu.item); setRenameValue(menu.item.name); setMenu(null); }}
          />
          <MenuItem
            icon={Copy}
            label="Copy"
            onClick={() => { setClipboard({ items: [menu.item.path], mode: 'copy' }); setMenu(null); }}
          />
          <MenuItem
            icon={Scissors}
            label="Cut"
            onClick={() => { setClipboard({ items: [menu.item.path], mode: 'cut' }); setMenu(null); }}
          />
          <div className="border-t border-line my-1" />
          <MenuItem
            icon={Trash2}
            label="Delete"
            danger
            onClick={() => { const it = menu.item; setMenu(null); remove([it.path]); }}
          />
        </div>
      )}

      {/* ── Overlays ────────────────────────────────────────────── */}
      {editing && (
        <Suspense fallback={<OverlayFallback />}>
          <FileEditor
            path={editing.path}
            name={editing.name}
            onClose={() => setEditing(null)}
            onSaved={() => load()}
          />
        </Suspense>
      )}

      {previewing && (
        <Suspense fallback={<OverlayFallback />}>
          <FilePreview
            path={previewing.path}
            name={previewing.name}
            size={previewing.size}
            onClose={() => setPreviewing(null)}
            onDownload={() => download(previewing)}
          />
        </Suspense>
      )}
    </div>
  );
}

function SortHeader({ label, active, dir, onClick, align = 'left', width = '' }: {
  label: string; active: boolean; dir: SortDir; onClick: () => void;
  align?: 'left' | 'right'; width?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`${width} flex items-center gap-1 hover:text-ink transition-colors
                  ${align === 'right' ? 'justify-end' : ''}
                  ${active ? 'text-ink' : ''}`}
    >
      {label}
      {active && <span aria-hidden="true">{dir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );
}

function SheetItem({ icon: Icon, label, onClick, mono, active }: {
  icon: any; label: string; onClick: () => void; mono?: boolean; active?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 h-11 text-body
                 hover:bg-raised transition-colors text-left
                 ${active ? 'text-accent' : 'text-ink'}`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-accent' : 'text-muted'}`} aria-hidden="true" />
      <span className={`truncate ${mono ? 'font-mono text-meta' : ''}`}>{label}</span>
    </button>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: {
  icon?: any; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 h-8 text-body transition-colors
                  ${danger ? 'text-danger hover:bg-danger/10' : 'text-ink hover:bg-raised'}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
      {label}
    </button>
  );
}

function RenameBox({ value, onChange, onCommit, onCancel, row }: {
  value: string; onChange: (v: string) => void;
  onCommit: () => void; onCancel: () => void; row?: boolean;
}) {
  return (
    <div className={row ? 'px-3 h-11 flex items-center border-b border-line/60 bg-raised' : 'p-2 bg-raised rounded-card'}>
      <input
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onCommit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={onCommit}
        aria-label="New name"
        className="field !h-8"
      />
    </div>
  );
}
