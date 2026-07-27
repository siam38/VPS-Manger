import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, ChevronDown, Eraser, Maximize2, Minimize2, Search, X,
} from 'lucide-react';
import {
  type LogLine, type LogLevel, LEVEL_TEXT, stripAnsi,
} from '../../lib/pm2';

interface Props {
  appName: string;
  lines: LogLine[];
  onClear: () => void;
  onClose: () => void;
}

const LEVELS: (LogLevel | 'all')[] = ['all', 'error', 'warn', 'info', 'debug', 'log'];

/**
 * Docked log panel.
 *
 * Replaces two separate surfaces: logs rendered *inside* each app card, plus a
 * `fixed inset-0` fullscreen overlay. Inline logs meant opening a stream
 * resized the card and shoved every row below it down the page — the list
 * jumped under your thumb on mobile. There is now one log surface: a bottom
 * dock on desktop, a full sheet on mobile.
 *
 * Two structural fixes carried over from the terminal rebuild:
 *
 *  - **Keyboard-aware height via VisualViewport.** `100dvh` accounts for
 *    collapsing browser chrome but NOT the on-screen keyboard, so the filter
 *    input and toolbar get pushed underneath it exactly when you start typing.
 *    Same bug class that hid the terminal key bar.
 *  - **Windowed rendering.** The old viewer rendered up to 1,000 <tr> rows
 *    with four cells each, re-rendering the whole table on every socket burst.
 *    Only the visible slice is mounted now.
 */
export function LogPanel({ appName, lines, onClear, onClose }: Props) {
  const [filter, setFilter] = useState('');
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(320);

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (level === 'all' && !term) return lines;
    return lines.filter(l => {
      if (level !== 'all' && l.level !== level) return false;
      if (term && !stripAnsi(l.text).toLowerCase().includes(term)) return false;
      return true;
    });
  }, [lines, filter, level]);

  /* Keyboard-aware height. Without this the toolbar sits under the on-screen
     keyboard the moment the filter input takes focus. */
  const [kbInset, setKbInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      // How much of the layout viewport the keyboard is covering.
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKbInset(inset);
    };
    onResize();
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);

  const ROW_H = 18;
  const OVERSCAN = 20;

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    // Drop out of auto-scroll as soon as the user reads history, and resume
    // when they return to the bottom. Fighting the user's scroll is the
    // single most irritating thing a log viewer can do.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, autoScroll]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(visible.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const slice = visible.slice(start, end);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 flex flex-col bg-canvas border-t border-line shadow-2xl animate-slide-up
                  ${expanded ? 'top-0' : 'top-auto h-[55vh] md:h-[42vh]'}`}
      style={{ paddingBottom: kbInset ? 0 : undefined, bottom: kbInset }}
      role="region"
      aria-label={`Logs for ${appName}`}
    >
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-2 sm:px-3 h-12 border-b border-line shrink-0">
        <span className="flex items-center gap-2 min-w-0 mr-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" aria-hidden="true" />
          <span className="text-body font-semibold text-ink truncate">{appName}</span>
          <span className="text-label text-subtle font-mono tabular-nums shrink-0 max-sm:hidden">
            {visible.length}{visible.length !== lines.length && `/${lines.length}`}
          </span>
        </span>

        <div className="relative flex-1 min-w-0 max-w-xs">
          <Search
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-subtle pointer-events-none"
            aria-hidden="true"
          />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter"
            aria-label="Filter log lines"
            className="field !h-8 !pl-7 !text-meta max-md:!h-10"
          />
        </div>

        {/* Level filter. A native <select> here inherited the browser's own
            dropdown chrome and looked pasted in from another app. */}
        <div className="relative shrink-0">
          <button
            onClick={() => setLevelOpen(o => !o)}
            className="btn btn-sm btn-quiet max-md:!h-10"
            aria-expanded={levelOpen}
            aria-haspopup="menu"
          >
            <span className={level === 'all' ? '' : LEVEL_TEXT[level]}>
              {level === 'all' ? 'All' : level}
            </span>
            <ChevronDown className="w-3 h-3 opacity-60" aria-hidden="true" />
          </button>
          {levelOpen && (
            <>
              <button
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setLevelOpen(false)}
                aria-label="Close level filter"
                tabIndex={-1}
              />
              <div className="absolute right-0 bottom-10 z-20 w-32 card shadow-2xl py-1" role="menu">
                {LEVELS.map(l => (
                  <button
                    key={l}
                    onClick={() => { setLevel(l); setLevelOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-meta hover:bg-raised transition-colors
                                ${l === level ? 'text-accent' : l === 'all' ? 'text-ink' : LEVEL_TEXT[l as LogLevel]}`}
                    role="menuitem"
                  >
                    {l === 'all' ? 'All levels' : l}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => {
            setAutoScroll(a => !a);
            if (!autoScroll && scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className={`btn-icon !w-8 !h-8 max-md:!w-10 max-md:!h-10 ${autoScroll ? 'text-accent' : ''}`}
          aria-label="Follow new output"
          aria-pressed={autoScroll}
          title="Follow output"
        >
          <ArrowDownToLine className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
        </button>

        <button onClick={onClear} className="btn-icon !w-8 !h-8 max-md:!w-10 max-md:!h-10" aria-label="Clear log view" title="Clear">
          <Eraser className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
        </button>

        <button
          onClick={() => setExpanded(e => !e)}
          className="btn-icon !w-8 !h-8 max-md:!w-10 max-md:!h-10 max-sm:hidden"
          aria-label={expanded ? 'Collapse log panel' : 'Expand log panel'}
        >
          {expanded
            ? <Minimize2 className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
            : <Maximize2 className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />}
        </button>

        <button onClick={onClose} className="btn-icon !w-8 !h-8 max-md:!w-10 max-md:!h-10" aria-label="Close logs">
          <X className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      {/* ── Stream ──────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto bg-[#050a0a] font-mono text-[11px] leading-[18px]"
        tabIndex={0}
        role="log"
        aria-live="polite"
      >
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-full text-meta text-subtle px-6 text-center">
            {lines.length === 0
              ? 'Waiting for output — this app has not logged anything since you opened it.'
              : 'No lines match the current filter.'}
          </div>
        ) : (
          // Spacer divs reproduce full scroll height while only the visible
          // slice is actually mounted.
          <div style={{ height: visible.length * ROW_H, position: 'relative' }}>
            <div style={{ position: 'absolute', top: start * ROW_H, left: 0, right: 0 }}>
              {slice.map(line => (
                <div
                  key={line.id}
                  className={`flex gap-2 px-2 hover:bg-white/[0.03] ${
                    line.stream === 'err' ? 'border-l-2 border-l-danger/60' : 'border-l-2 border-l-transparent'
                  }`}
                  style={{ height: ROW_H }}
                >
                  <span className="text-subtle/60 select-none shrink-0 tabular-nums">{line.timestamp}</span>
                  <span className={`truncate ${LEVEL_TEXT[line.level]}`}>{stripAnsi(line.text)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
