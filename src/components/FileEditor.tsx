import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronDown, Check, CornerDownLeft, Hash, Indent, Outdent,
  Redo2, Save, Search, Settings2, Slash, Type, Undo2, WrapText, X,
} from 'lucide-react';
import CodeEditor, { type CodeEditorHandle, type CursorInfo } from './CodeEditor';
import { languageLabel } from '../lib/editorLanguages';
import { useToast } from '../lib/toast';
import { apiGet, apiPost } from '../lib/api';
import { formatBytes } from '../lib/utils';

interface Props {
  path: string;
  name: string;
  onClose: () => void;
  onSaved?: () => void;
}

interface Prefs {
  wrap: boolean;
  lineNumbers: boolean;
  fontSize: number;
  tabSize: number;
  useTabs: boolean;
  autoSave: boolean;
}

const PREF_KEY = 'vps_editor_prefs';

function loadPrefs(): Prefs {
  const fallback: Prefs = {
    wrap: true, lineNumbers: true, fontSize: 13,
    tabSize: 2, useTabs: false, autoSave: false,
  };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch { return fallback; }
}

/** Keys a phone keyboard does not have, but code needs constantly. */
const MOBILE_KEYS = ['\t', '{', '}', '(', ')', '[', ']', '<', '>', '=', '"', "'", '`', '|', '&', '$', '_', '-', '/', ':', ';', '*', '#', '!'];

export default function FileEditor({ path, name, onClose, onSaved }: Props) {
  const toast = useToast();
  const editorRef = useRef<CodeEditorHandle>(null);

  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [fileSize, setFileSize] = useState(0);
  const [cursor, setCursor] = useState<CursorInfo>({
    line: 1, col: 1, selLength: 0, selLines: 0, totalLines: 1,
  });

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [showSettings, setShowSettings] = useState(false);
  const [showKeyBar, setShowKeyBar] = useState(
    () => localStorage.getItem('vps_editor_keybar') !== 'false'
  );

  const dirty = content !== savedContent;
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  useEffect(() => {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  }, [prefs]);

  // ── Load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    apiGet<{ content: string; size: number }>(
      `/api/files/content?path=${encodeURIComponent(path)}`
    )
      .then(data => {
        if (cancelled) return;
        setContent(data.content);
        setSavedContent(data.content);
        setFileSize(data.size ?? data.content.length);
      })
      .catch(e => { if (!cancelled) setLoadError(e.message || 'Could not open file'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path]);

  // ── Save ──────────────────────────────────────────────────────────
  const save = useCallback(async (silent = false) => {
    const value = editorRef.current?.getValue() ?? '';
    setSaving(true);
    try {
      const res = await apiPost<{ size: number; restarted?: any }>(
        '/api/files/save', { path, content: value }
      );
      setSavedContent(value);
      setFileSize(res?.size ?? value.length);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1800);
      onSaved?.();
      if (!silent) {
        if (res?.restarted) {
          toast.success({
            title: 'Saved',
            description: `${name} written · PM2 app restarted`,
          });
        } else {
          toast.success({ title: 'Saved', description: name, duration: 2000 });
        }
      }
    } catch (e: any) {
      toast.error({ title: 'Save failed', description: e.message });
    } finally {
      setSaving(false);
    }
  }, [path, name, onSaved, toast]);

  // Autosave: debounce 1.5s after typing stops.
  useEffect(() => {
    if (!prefs.autoSave || !dirty || loading) return;
    const timer = setTimeout(() => { save(true); }, 1500);
    return () => clearTimeout(timer);
  }, [content, prefs.autoSave, dirty, loading, save]);

  // Warn on tab close with unsaved work.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const requestClose = useCallback(async () => {
    if (!dirtyRef.current) { onClose(); return; }
    const ok = await toast.confirm({
      title: 'Discard unsaved changes?',
      description: `${name} has edits that have not been written to disk.`,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      danger: true,
    });
    if (ok) onClose();
  }, [name, onClose, toast]);

  // Escape closes, unless a CodeMirror panel (search) is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('.cm-panel')) return;
      if (showSettings) { setShowSettings(false); return; }
      requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose, showSettings]);

  const setPref = <K extends keyof Prefs>(key: K, value: Prefs[K]) =>
    setPrefs(p => ({ ...p, [key]: value }));

  const insertKey = (key: string) => editorRef.current?.insert(key);

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-canvas" role="dialog" aria-modal="true" aria-label={`Editing ${name}`}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-center gap-1.5 px-2 sm:px-3 h-14 border-b border-line bg-surface shrink-0">
        <button className="btn-icon" onClick={requestClose} aria-label="Close editor">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-body font-medium text-ink truncate">{name}</p>
            {dirty && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                title="Unsaved changes"
                aria-label="Unsaved changes"
              />
            )}
          </div>
          <p className="text-label text-muted truncate hidden sm:block">{path}</p>
        </div>

        {/* Desktop editing controls */}
        <div className="hidden md:flex items-center gap-0.5">
          <button className="btn-icon" onClick={() => editorRef.current?.undo()} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Undo2 className="w-4 h-4" aria-hidden="true" />
          </button>
          <button className="btn-icon" onClick={() => editorRef.current?.redo()} aria-label="Redo" title="Redo (Ctrl+Y)">
            <Redo2 className="w-4 h-4" aria-hidden="true" />
          </button>
          <button className="btn-icon" onClick={() => editorRef.current?.outdent()} aria-label="Outdent" title="Outdent">
            <Outdent className="w-4 h-4" aria-hidden="true" />
          </button>
          <button className="btn-icon" onClick={() => editorRef.current?.indent()} aria-label="Indent" title="Indent">
            <Indent className="w-4 h-4" aria-hidden="true" />
          </button>
          <button className="btn-icon" onClick={() => editorRef.current?.toggleComment()} aria-label="Toggle comment" title="Toggle comment (Ctrl+/)">
            <Slash className="w-4 h-4" aria-hidden="true" />
          </button>
          <span className="w-px h-5 bg-line mx-1" aria-hidden="true" />
        </div>

        <button className="btn-icon" onClick={() => editorRef.current?.openSearch()} aria-label="Find and replace" title="Find (Ctrl+F)">
          <Search className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className="relative">
          <button
            className={`btn-icon ${showSettings ? 'text-accent bg-raised' : ''}`}
            onClick={() => setShowSettings(s => !s)}
            aria-label="Editor settings"
            aria-expanded={showSettings}
          >
            <Settings2 className="w-4 h-4" aria-hidden="true" />
          </button>

          {showSettings && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSettings(false)} aria-hidden="true" />
              <div className="absolute right-0 top-11 z-20 w-64 card shadow-2xl p-3 animate-slide-up">
                <p className="eyebrow mb-2">Editor</p>

                <ToggleRow label="Word wrap" icon={WrapText}
                  on={prefs.wrap} onClick={() => setPref('wrap', !prefs.wrap)} />
                <ToggleRow label="Line numbers" icon={Hash}
                  on={prefs.lineNumbers} onClick={() => setPref('lineNumbers', !prefs.lineNumbers)} />
                <ToggleRow label="Auto-save" icon={Check}
                  on={prefs.autoSave} onClick={() => setPref('autoSave', !prefs.autoSave)} />
                <ToggleRow label="Key bar (mobile)" icon={CornerDownLeft}
                  on={showKeyBar}
                  onClick={() => {
                    const next = !showKeyBar;
                    setShowKeyBar(next);
                    localStorage.setItem('vps_editor_keybar', String(next));
                  }} />

                <div className="border-t border-line my-2" />

                <div className="flex items-center justify-between h-9">
                  <span className="flex items-center gap-2 text-body text-ink">
                    <Type className="w-3.5 h-3.5 text-muted" aria-hidden="true" /> Font size
                  </span>
                  <div className="flex items-center gap-1">
                    <button className="btn btn-quiet btn-sm !px-2"
                      onClick={() => setPref('fontSize', Math.max(10, prefs.fontSize - 1))}
                      aria-label="Decrease font size">−</button>
                    <span className="text-meta text-ink tabular w-6 text-center">{prefs.fontSize}</span>
                    <button className="btn btn-quiet btn-sm !px-2"
                      onClick={() => setPref('fontSize', Math.min(24, prefs.fontSize + 1))}
                      aria-label="Increase font size">+</button>
                  </div>
                </div>

                <div className="flex items-center justify-between h-9">
                  <span className="text-body text-ink">Indent</span>
                  <select
                    value={`${prefs.useTabs ? 'tab' : 'space'}-${prefs.tabSize}`}
                    onChange={e => {
                      const [type, sizeStr] = e.target.value.split('-');
                      setPrefs(p => ({ ...p, useTabs: type === 'tab', tabSize: Number(sizeStr) }));
                    }}
                    className="field !w-auto !h-8 !px-2 text-meta"
                    aria-label="Indentation style"
                  >
                    <option value="space-2">2 spaces</option>
                    <option value="space-4">4 spaces</option>
                    <option value="space-8">8 spaces</option>
                    <option value="tab-4">Tabs</option>
                  </select>
                </div>
              </div>
            </>
          )}
        </div>

        <button
          className={`btn ${dirty ? 'btn-primary' : 'btn-quiet'} btn-sm`}
          onClick={() => save()}
          disabled={saving || loading || (!dirty && !justSaved)}
        >
          {justSaved && !dirty
            ? <Check className="w-4 h-4" aria-hidden="true" />
            : <Save className="w-4 h-4" aria-hidden="true" />}
          <span className="hidden sm:inline">
            {saving ? 'Saving…' : justSaved && !dirty ? 'Saved' : 'Save'}
          </span>
        </button>
      </header>

      {/* ── Editor ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-canvas z-10">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {loadError ? (
          <div className="empty h-full">
            <X className="w-10 h-10 text-danger mb-2" aria-hidden="true" />
            <p className="empty-title">Could not open this file</p>
            <p className="empty-sub">{loadError}</p>
            <button className="btn btn-quiet mt-3" onClick={onClose}>Back to files</button>
          </div>
        ) : !loading && (
          <CodeEditor
            ref={editorRef}
            docKey={path}
            fileName={name}
            value={content}
            wrap={prefs.wrap}
            showLineNumbers={prefs.lineNumbers}
            fontSize={prefs.fontSize}
            tabSize={prefs.tabSize}
            useTabs={prefs.useTabs}
            onChange={setContent}
            onSave={() => save()}
            onCursor={setCursor}
          />
        )}
      </div>

      {/* ── Mobile key bar ─────────────────────────────────────── */}
      {showKeyBar && !loading && !loadError && (
        <div
          className="md:hidden flex items-stretch gap-1 px-1.5 py-1.5 border-t border-line
                     bg-surface overflow-x-auto shrink-0"
          role="toolbar"
          aria-label="Editor key shortcuts"
        >
          <KeyBtn onClick={() => editorRef.current?.undo()} aria-label="Undo">
            <Undo2 className="w-4 h-4" aria-hidden="true" />
          </KeyBtn>
          <KeyBtn onClick={() => editorRef.current?.redo()} aria-label="Redo">
            <Redo2 className="w-4 h-4" aria-hidden="true" />
          </KeyBtn>
          <span className="w-px bg-line shrink-0 my-1" aria-hidden="true" />
          {MOBILE_KEYS.map(k => (
            <KeyBtn key={k} onClick={() => insertKey(k)} aria-label={k === '\t' ? 'Insert tab' : `Insert ${k}`}>
              <span className="font-mono text-body">{k === '\t' ? '⇥' : k}</span>
            </KeyBtn>
          ))}
        </div>
      )}

      {/* ── Status bar ─────────────────────────────────────────── */}
      <footer className="flex items-center justify-between gap-3 px-3 h-8 border-t border-line bg-surface text-label text-muted shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="truncate">{languageLabel(name)}</span>
          <span className="hidden sm:inline">UTF-8</span>
          <span className="tabular">{formatBytes(fileSize)}</span>
          {prefs.autoSave && <span className="text-accent">Auto-save</span>}
        </div>
        <div className="flex items-center gap-3 shrink-0 tabular">
          {cursor.selLength > 0 && (
            <span className="text-accent">
              {cursor.selLength} sel{cursor.selLines > 1 ? ` · ${cursor.selLines} ln` : ''}
            </span>
          )}
          <span>Ln {cursor.line}, Col {cursor.col}</span>
          <span className="hidden sm:inline">{cursor.totalLines} lines</span>
        </div>
      </footer>
    </div>
  );
}

function KeyBtn({ children, onClick, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      // Keeps the virtual keyboard open: without this the editor loses focus
      // on tap and the keyboard collapses on every single key press.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className="shrink-0 min-w-[38px] h-10 px-2 rounded-control bg-raised border border-line
                 text-ink flex items-center justify-center
                 active:bg-accent/20 active:border-accent/40 transition-colors"
      {...rest}
    >
      {children}
    </button>
  );
}

function ToggleRow({ label, icon: Icon, on, onClick }: {
  label: string; icon: any; on: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className="w-full flex items-center justify-between h-9 px-1 rounded-control
                 hover:bg-raised transition-colors"
    >
      <span className="flex items-center gap-2 text-body text-ink">
        <Icon className="w-3.5 h-3.5 text-muted" aria-hidden="true" /> {label}
      </span>
      <span
        className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0
                    ${on ? 'bg-accent' : 'bg-line-strong'}`}
        aria-hidden="true"
      >
        <span
          className={`block w-4 h-4 rounded-full bg-canvas transition-transform
                      ${on ? 'translate-x-4' : ''}`}
        />
      </span>
    </button>
  );
}
