import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, X, Search, ChevronUp, ChevronDown, Copy, ClipboardPaste,
  Type, Eraser, SplitSquareHorizontal, Terminal as TerminalIcon,
  RotateCcw, Zap, ChevronsUpDown,
} from 'lucide-react';
import TerminalPane, { type TerminalPaneHandle, type PaneStatus } from '../components/TerminalPane';
import TerminalKeyBar from '../components/TerminalKeyBar';
import { useToast } from '../lib/toast';
import { FONT_MIN, FONT_MAX, FONT_DEFAULT, loadPref, savePref } from '../lib/termTheme';

interface Session {
  id: string;
  /** Shell-reported OSC title. Falls back to a counter only until one arrives. */
  title: string;
  index: number;
  status: PaneStatus;
  detail?: string;
}

/** Commands worth one tap rather than typing on a phone. */
const QUICK_COMMANDS: Array<{ label: string; cmd: string }> = [
  { label: 'Disk usage', cmd: 'df -h' },
  { label: 'Memory', cmd: 'free -h' },
  { label: 'Top processes', cmd: 'ps aux --sort=-%cpu | head -15' },
  { label: 'Listening ports', cmd: 'ss -tulpn' },
  { label: 'Uptime', cmd: 'uptime' },
  { label: 'Largest dirs', cmd: 'du -xh --max-depth=1 / 2>/dev/null | sort -rh | head -15' },
  { label: 'Journal (last 50)', cmd: 'journalctl -n 50 --no-pager' },
  { label: 'Clear', cmd: 'clear' },
];

let seq = 0;
const nextId = () => `term_${Date.now()}_${++seq}`;

export default function Terminal() {
  const toast = useToast();

  const [sessions, setSessions] = useState<Session[]>(() => [
    { id: nextId(), title: '', index: 1, status: 'connecting' },
  ]);
  const [activeId, setActiveId] = useState<string>(() => '');
  const [fontSize, setFontSize] = useState<number>(() => loadPref('fontSize', FONT_DEFAULT));
  const [splitId, setSplitId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [noMatch, setNoMatch] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);

  const panes = useRef(new Map<string, TerminalPaneHandle | null>());
  const searchInput = useRef<HTMLInputElement>(null);
  const quickRef = useRef<HTMLDivElement>(null);
  const fontRef = useRef<HTMLDivElement>(null);

  // First session's id is generated in the initializer, so adopt it on mount.
  useEffect(() => {
    if (!activeId && sessions.length) setActiveId(sessions[0].id);
  }, [activeId, sessions]);

  useEffect(() => savePref('fontSize', fontSize), [fontSize]);

  const active = useMemo(
    () => sessions.find(s => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  const paneOf = (id: string | null) => (id ? panes.current.get(id) ?? null : null);

  const patch = useCallback((id: string, next: Partial<Session>) => {
    setSessions(prev => prev.map(s => (s.id === id ? { ...s, ...next } : s)));
  }, []);

  const addSession = useCallback(() => {
    setSessions(prev => {
      const index = (prev.reduce((m, s) => Math.max(m, s.index), 0) || 0) + 1;
      const s: Session = { id: nextId(), title: '', index, status: 'connecting' };
      queueMicrotask(() => setActiveId(s.id));
      return [...prev, s];
    });
  }, []);

  const closeSession = useCallback((id: string) => {
    setSessions(prev => {
      if (prev.length === 1) return prev; // never leave an empty shell page
      const i = prev.findIndex(s => s.id === id);
      const next = prev.filter(s => s.id !== id);
      panes.current.delete(id);
      setSplitId(cur => (cur === id ? null : cur));
      setActiveId(cur => (cur === id ? next[Math.max(0, i - 1)].id : cur));
      return next;
    });
  }, []);

  /** Close the pane's tab keyboard-side without stealing the terminal's keys. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey && e.shiftKey;
      if (mod && e.key.toLowerCase() === 't') { e.preventDefault(); addSession(); return; }
      if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); if (activeId) closeSession(activeId); return; }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        queueMicrotask(() => searchInput.current?.focus());
        return;
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        paneOf(activeId)?.clearSearch();
        paneOf(activeId)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addSession, closeSession, activeId, searchOpen]);

  // Close popovers on outside click.
  useEffect(() => {
    if (!quickOpen && !fontOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (quickOpen && quickRef.current && !quickRef.current.contains(t)) setQuickOpen(false);
      if (fontOpen && fontRef.current && !fontRef.current.contains(t)) setFontOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [quickOpen, fontOpen]);

  // Refit on layout change (split toggled, key bar shown, window resized).
  useEffect(() => {
    const fitAll = () => panes.current.forEach(p => p?.fit());
    const t = setTimeout(fitAll, 60);
    window.addEventListener('resize', fitAll);
    return () => { clearTimeout(t); window.removeEventListener('resize', fitAll); };
  }, [splitId, searchOpen, activeId, sessions.length]);

  const runSearch = (dir: 'next' | 'prev') => {
    const p = paneOf(activeId);
    if (!p || !query) return;
    setNoMatch(!p.search(query, dir));
  };

  const doCopy = async () => {
    const ok = await paneOf(activeId)?.copySelection();
    if (ok) toast.success('Copied to clipboard');
    else toast.info('Select some text first');
  };

  const doPaste = async () => {
    const p = paneOf(activeId);
    if (!p) return;
    try {
      await p.paste();
      p.focus();
    } catch {
      toast.error('Clipboard unavailable — use Ctrl+Shift+V');
    }
  };

  const runQuick = (cmd: string) => {
    const p = paneOf(activeId);
    if (!p) return;
    p.send(cmd + '\r');
    p.focus();
    setQuickOpen(false);
  };

  const sendKey = (data: string) => {
    const p = paneOf(activeId);
    p?.send(data);
  };

  const restart = (id: string) => {
    // Remount by swapping the key: the old pane's cleanup kills its PTY.
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    const fresh = nextId();
    panes.current.delete(id);
    setSessions(prev => prev.map(x =>
      x.id === id ? { ...x, id: fresh, status: 'connecting', detail: undefined, title: '' } : x,
    ));
    setActiveId(cur => (cur === id ? fresh : cur));
    setSplitId(cur => (cur === id ? fresh : cur));
  };

  /** Shell titles are long and path-shaped; show the informative tail. */
  const tabLabel = (s: Session) => {
    if (!s.title) return `Shell ${s.index}`;
    const t = s.title.replace(/^[^:]*:\s*/, '').trim();
    if (!t) return `Shell ${s.index}`;
    const parts = t.split('/');
    return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : t;
  };

  /** Only a live shell can accept input, so controls that write to it gate on it. */
  const live = active?.status === 'ready';

  const statusDot = (st: PaneStatus) =>
    st === 'ready' ? 'bg-success'
      : st === 'connecting' ? 'bg-warning animate-pulse'
        : st === 'disconnected' ? 'bg-warning'
          : 'bg-danger';

  const renderPane = (id: string) => (
    <TerminalPane
      key={id}
      ref={(h: TerminalPaneHandle | null) => { panes.current.set(id, h); }}
      fontSize={fontSize}
      onTitle={t => patch(id, { title: t })}
      onStatus={(status, detail) => patch(id, { status, detail })}
      onSelectionChange={has => { if (id === activeId) setHasSelection(has); }}
    />
  );

  const split = splitId && splitId !== activeId ? splitId : null;
  const splitSession = split ? sessions.find(s => s.id === split) : null;

  return (
    // `h-full` alone collapses here: the shell's <main> is `flex-1` on a block
    // box, so it has no definite height for a percentage child to resolve
    // against below `lg`. That left this page 176px tall, the absolutely
    // positioned panes in a 0-height container, and the key bar riding up over
    // the prompt. Pin to the viewport minus the 56px mobile header instead.
    // dvh (not vh) so the bar tracks mobile browser chrome collapsing.
    <div className="max-lg:h-[calc(100dvh-3.5rem)] lg:h-full flex flex-col animate-fade-in min-h-0 overflow-hidden">
      {/* ── Tab strip ────────────────────────────────────────────────
          Tabs carry a live status dot and the shell's own title, so a
          disconnected or exited session is visible without opening it. */}
      <div className="flex items-stretch bg-surface border-b border-line shrink-0">
        <div className="flex items-stretch overflow-x-auto scrollbar-none min-w-0 flex-1">
          {sessions.map(s => {
            const on = s.id === activeId;
            return (
              <div
                key={s.id}
                role="tab"
                aria-selected={on}
                tabIndex={0}
                onClick={() => setActiveId(s.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveId(s.id); } }}
                title={s.title || `Shell ${s.index}`}
                className={`group relative flex items-center gap-2 pl-3 pr-2 h-10 max-md:h-11 shrink-0 max-w-[13rem]
                  cursor-pointer text-meta transition-colors
                  ${on ? 'bg-canvas text-ink' : 'text-muted hover:text-ink hover:bg-raised/60'}`}
              >
                {/* Active state reads structurally via a rail, not colour alone. */}
                {on && <span className="absolute inset-x-0 top-0 h-[2px] bg-accent" aria-hidden />}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(s.status)}`} aria-hidden />
                <span className="truncate font-mono">{tabLabel(s)}</span>
                {sessions.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); closeSession(s.id); }}
                    aria-label={`Close ${tabLabel(s)}`}
                    className="w-5 h-5 max-md:w-7 max-md:h-7 rounded-chip flex items-center justify-center
                               text-subtle hover:text-ink hover:bg-line shrink-0
                               md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 transition-opacity"
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                )}
              </div>
            );
          })}
          <button
            onClick={addSession}
            aria-label="New shell session"
            title="New shell (Ctrl+Shift+T)"
            className="w-10 h-10 max-md:w-11 max-md:h-11 shrink-0 flex items-center justify-center
                       text-muted hover:text-ink hover:bg-raised transition-colors"
          >
            <Plus className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* The tab row was ~1100px of dead space at 1440. Session identity now
            lives here, where it is glanceable, instead of in an 11px ticker
            pinned to the bottom of the window. */}
        <div className="hidden md:flex items-center gap-2 px-3 shrink-0 text-label font-mono text-subtle">
          <TerminalIcon className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
          <span className="truncate max-w-[22rem]" title={active?.title || ''}>
            {active?.title || 'bash'}
          </span>
        </div>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────
          Quiet ghost controls behind dividers. No filled buttons here —
          nothing in a terminal toolbar is the page's primary action. */}
      <div className="flex items-center gap-1 px-2 h-11 bg-surface border-b border-line shrink-0 overflow-x-auto scrollbar-none">
        <div className="relative" ref={quickRef}>
          <button
            onClick={() => setQuickOpen(o => !o)}
            aria-expanded={quickOpen}
            className="btn btn-sm btn-quiet gap-1.5"
          >
            <Zap className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span className="max-sm:hidden">Commands</span>
          </button>
          {quickOpen && (
            <div className="absolute z-30 mt-1 left-0 w-60 bg-raised border border-line rounded-card shadow-xl py-1">
              {QUICK_COMMANDS.map(q => (
                <button
                  key={q.cmd}
                  onClick={() => runQuick(q.cmd)}
                  className="w-full text-left px-3 py-2 hover:bg-line/60 transition-colors"
                >
                  <div className="text-body text-ink">{q.label}</div>
                  <div className="text-label font-mono text-subtle truncate">{q.cmd}</div>
                </button>
              ))}
              {/* Shortcut hints belong in a palette you open, not as permanent
                  11px chrome welded to the bottom of the window. */}
              <div className="mt-1 pt-2 border-t border-line px-3 pb-1 space-y-1">
                <div className="text-label uppercase tracking-wide text-subtle mb-1">Shortcuts</div>
                {[['New shell', 'Ctrl+Shift+T'], ['Close shell', 'Ctrl+Shift+W'], ['Find', 'Ctrl+Shift+F']].map(([k, v]) => (
                  <div key={v} className="flex justify-between gap-3 text-label">
                    <span className="text-subtle">{k}</span>
                    <span className="font-mono text-muted">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <span className="w-px h-5 bg-line shrink-0 mx-1" aria-hidden />

        <button onClick={doCopy} disabled={!hasSelection} className="btn btn-sm btn-quiet gap-1.5" aria-label="Copy selection">
          <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span className="max-lg:hidden">Copy</span>
        </button>
        <button onClick={doPaste} disabled={!live} className="btn btn-sm btn-quiet gap-1.5" aria-label="Paste from clipboard">
          <ClipboardPaste className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span className="max-lg:hidden">Paste</span>
        </button>

        <span className="w-px h-5 bg-line shrink-0 mx-1" aria-hidden />

        <button
          onClick={() => { setSearchOpen(o => !o); queueMicrotask(() => searchInput.current?.focus()); }}
          aria-label="Search scrollback"
          title="Search (Ctrl+Shift+F)"
          className={`btn btn-sm gap-1.5 ${searchOpen ? 'btn-quiet text-accent' : 'btn-quiet'}`}
        >
          <Search className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span className="max-lg:hidden">Find</span>
        </button>

        <div className="relative" ref={fontRef}>
          {/* A bare "14px" label reads as static text. The chevron is what says
              this is a control you can open. */}
          <button onClick={() => setFontOpen(o => !o)} aria-expanded={fontOpen} className="btn btn-sm btn-quiet gap-1.5" aria-label="Text size">
            <Type className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span className="max-lg:hidden tabular">{fontSize}px</span>
            <ChevronsUpDown className="w-3 h-3 text-subtle" strokeWidth={1.75} aria-hidden />
          </button>
          {fontOpen && (
            <div className="absolute z-30 mt-1 left-0 w-52 bg-raised border border-line rounded-card shadow-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-label uppercase text-subtle tracking-wide">Text size</span>
                <span className="text-meta font-mono tabular text-ink">{fontSize}px</span>
              </div>
              <input
                type="range" min={FONT_MIN} max={FONT_MAX} value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                className="w-full accent-accent"
                aria-label="Terminal text size"
              />
            </div>
          )}
        </div>

        <button
          onClick={() => setSplitId(cur => {
            if (cur) return null;
            const other = sessions.find(s => s.id !== activeId);
            if (!other) { toast.info('Open a second shell to split'); return null; }
            return other.id;
          })}
          disabled={sessions.length < 2}
          title={sessions.length < 2 ? 'Open a second shell to split' : 'Toggle split view'}
          className={`btn btn-sm btn-quiet gap-1.5 max-md:hidden ${split ? 'text-accent' : ''}`}
          aria-label="Toggle split view"
        >
          <SplitSquareHorizontal className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span className="max-lg:hidden">Split</span>
        </button>

        <div className="flex-1 min-w-[8px]" />

        <button
          onClick={() => { paneOf(activeId)?.clear(); paneOf(activeId)?.focus(); }}
          className="btn btn-sm btn-ghost gap-1.5" aria-label="Clear terminal"
        >
          <Eraser className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span className="max-lg:hidden">Clear</span>
        </button>
      </div>

      {/* ── Search bar ───────────────────────────────────────────── */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-2 py-2 bg-raised border-b border-line shrink-0">
          <Search className="w-4 h-4 text-subtle shrink-0" strokeWidth={1.75} />
          <input
            ref={searchInput}
            value={query}
            onChange={e => { setQuery(e.target.value); setNoMatch(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); runSearch(e.shiftKey ? 'prev' : 'next'); }
            }}
            placeholder="Find in scrollback"
            aria-label="Find in terminal scrollback"
            className={`field h-8 flex-1 ${noMatch ? 'border-danger/60' : ''}`}
          />
          <button onClick={() => runSearch('prev')} className="btn-icon w-8 h-8" aria-label="Previous match">
            <ChevronUp className="w-4 h-4" strokeWidth={1.75} />
          </button>
          <button onClick={() => runSearch('next')} className="btn-icon w-8 h-8" aria-label="Next match">
            <ChevronDown className="w-4 h-4" strokeWidth={1.75} />
          </button>
          <button
            onClick={() => { setSearchOpen(false); paneOf(activeId)?.clearSearch(); paneOf(activeId)?.focus(); }}
            className="btn-icon w-8 h-8" aria-label="Close search"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* ── Panes ────────────────────────────────────────────────── */}
      <div className="flex-1 relative min-h-0 flex">
        <div className="relative flex-1 min-w-0">
          {sessions.map(s => (
            <div
              key={s.id}
              className={`absolute inset-0 ${s.id === activeId ? '' : 'invisible pointer-events-none'}`}
              // Kept mounted, not unmounted: a hidden tab must keep its
              // running process and scrollback alive.
            >
              {renderPane(s.id)}
              {(s.status === 'disconnected' || s.status === 'exited') && s.id === activeId && (
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-3 py-2 bg-surface/95 border-t border-line backdrop-blur">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(s.status)}`} aria-hidden />
                  <span className="text-meta text-muted truncate flex-1">
                    {s.detail || (s.status === 'exited' ? 'Session ended' : 'Connection lost')}
                  </span>
                  <button onClick={() => restart(s.id)} className="btn btn-sm btn-quiet gap-1.5 shrink-0">
                    <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
                    New session
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {splitSession && (
          <div className="relative flex-1 min-w-0 border-l border-line max-md:hidden">
            <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-2 px-3 h-8 bg-surface/90 border-b border-line backdrop-blur">
              <TerminalIcon className="w-3.5 h-3.5 text-subtle" strokeWidth={1.75} />
              <span className="text-label font-mono text-muted truncate flex-1">{tabLabel(splitSession)}</span>
              <button onClick={() => setSplitId(null)} className="btn-icon w-6 h-6" aria-label="Close split pane">
                <X className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="absolute inset-0 pt-8">{renderPane(splitSession.id)}</div>
          </div>
        )}
      </div>

      {/* ── Status bar (desktop) ───────────────────────────────────
          Shortcut hints used to live here as permanent low-contrast chrome —
          onboarding content occupying the one strip that should carry live
          state. Moved into the Commands popover. */}
      <div className="hidden md:flex items-center gap-3 px-3 h-7 bg-surface border-t border-line text-label text-subtle shrink-0">
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot(active?.status ?? 'connecting')}`} aria-hidden />
          <span className="capitalize text-muted">{active?.status ?? 'connecting'}</span>
        </span>
        <span className="w-px h-3 bg-line" aria-hidden />
        <span className="font-mono tabular">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
        <span className="w-px h-3 bg-line" aria-hidden />
        <span className="font-mono tabular">{fontSize}px</span>
        <div className="flex-1" />
        {active?.detail && <span className="font-mono truncate max-w-[28rem]">{active.detail}</span>}
      </div>

      {/* Mobile: the keys a phone keyboard cannot produce. */}
      <TerminalKeyBar onKey={sendKey} onPaste={doPaste} />
    </div>
  );
}
