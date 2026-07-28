import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Terminal as XTermType } from '@xterm/xterm';
import type { FitAddon as FitAddonType } from '@xterm/addon-fit';
import type { SearchAddon as SearchAddonType } from '@xterm/addon-search';
import { getSocket } from '../lib/socket';
import { termTheme, TERM_BG, SCROLLBACK_DEFAULT, ctrlByte } from '../lib/termTheme';

// Local stylesheet. This was previously pulled from cdn.jsdelivr.net on every
// visit — an external request for a file already sitting in node_modules, which
// also broke the page offline or behind a strict CSP.
import '@xterm/xterm/css/xterm.css';

export type PaneStatus = 'connecting' | 'ready' | 'disconnected' | 'exited';

export interface TerminalPaneHandle {
  focus(): void;
  fit(): void;
  write(data: string): void;
  send(data: string): void;
  clear(): void;
  search(query: string, dir: 'next' | 'prev'): boolean;
  clearSearch(): void;
  copySelection(): Promise<boolean>;
  paste(): Promise<void>;
  setFontSize(px: number): void;
  scrollToBottom(): void;
  hasSelection(): boolean;
}

export type ModState = 'off' | 'once' | 'lock';

interface Props {
  fontSize: number;
  scrollback?: number;
  cwd?: string;
  /**
   * Sticky modifiers armed by the mobile key bar. Read through a ref (not a
   * prop value) because `onData` is registered once at mount and must always
   * see the latest state without re-subscribing.
   */
  mods?: React.MutableRefObject<{ ctrl: ModState; alt: ModState }>;
  onModsUsed?: () => void;
  onTitle?: (title: string) => void;
  onStatus?: (status: PaneStatus, detail?: string) => void;
  onSelectionChange?: (has: boolean) => void;
  onBell?: () => void;
}

/**
 * A single PTY-backed terminal.
 *
 * The previous implementation stashed the xterm modules on `window.__xterm`,
 * located its DOM node through a `setTimeout(50)` race, and — the real bug —
 * registered a `terminal:data` socket listener per tab that was never removed.
 * Every tab ever opened kept receiving and writing into a disposed terminal for
 * the life of the page. Each pane now owns its lifecycle and tears down cleanly.
 */
const TerminalPane = React.forwardRef<TerminalPaneHandle, Props>(function TerminalPane(
  { fontSize, scrollback = SCROLLBACK_DEFAULT, cwd, mods, onModsUsed, onTitle, onStatus, onSelectionChange, onBell },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTermType | null>(null);
  const fitRef = useRef<FitAddonType | null>(null);
  const searchRef = useRef<SearchAddonType | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const disposedRef = useRef(false);
  const [booted, setBooted] = useState(false);

  // Callbacks live in refs so a parent re-render never tears down the terminal.
  const cbRef = useRef({ onTitle, onStatus, onSelectionChange, onBell, mods, onModsUsed });
  cbRef.current = { onTitle, onStatus, onSelectionChange, onBell, mods, onModsUsed };

  useEffect(() => {
    let cancelled = false;
    // Re-arm for THIS effect run.
    //
    // disposedRef is per-component-instance, not per-effect-run, and cleanup
    // sets it true. React 18 StrictMode mounts, cleans up, then re-mounts the
    // *same* instance in development, so without this reset the flag stayed
    // true forever: the second run created a PTY, the ack took the "raced
    // against unmount" branch, and immediately destroyed the shell it had just
    // asked for. Status never reached 'ready' and the pane sat on "Connecting"
    // with no error anywhere — the server had done everything correctly.
    // Any future remount (route change, key change) hits the same trap.
    disposedRef.current = false;
    // Captured for cleanup: the effect must not read refs that may have moved on.
    const cleanups: Array<() => void> = [];

    (async () => {
      const [{ Terminal }, { FitAddon }, { SearchAddon }, { WebLinksAddon }, { Unicode11Addon }] =
        await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-search'),
          import('@xterm/addon-web-links'),
          import('@xterm/addon-unicode11'),
        ]);

      if (cancelled || !hostRef.current) return;

      const term = new Terminal({
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
        fontSize,
        lineHeight: 1.25,
        letterSpacing: 0,
        cursorBlink: true,
        cursorStyle: 'bar',
        cursorWidth: 2,
        scrollback,
        theme: termTheme,
        allowProposedApi: true,
        // Right-click should open the browser menu (Copy/Paste) rather than
        // being swallowed, since that is the desktop paste path users expect.
        rightClickSelectsWord: true,
        macOptionIsMeta: true,
        // Touch scrolling in the viewport instead of hijacking the gesture.
        smoothScrollDuration: 0,
      });

      const fit = new FitAddon();
      const search = new SearchAddon();
      term.loadAddon(fit);
      term.loadAddon(search);
      term.loadAddon(new WebLinksAddon());

      const uni = new Unicode11Addon();
      term.loadAddon(uni);
      term.unicode.activeVersion = '11';

      term.open(hostRef.current);

      termRef.current = term;
      fitRef.current = fit;
      searchRef.current = search;

      try { fit.fit(); } catch { /* not laid out yet */ }

      // Tab titles now track the shell's OSC title (cwd, running command)
      // instead of a static "Terminal 1" counter.
      cleanups.push(term.onTitleChange(t => cbRef.current.onTitle?.(t)).dispose);
      cleanups.push(term.onSelectionChange(() =>
        cbRef.current.onSelectionChange?.(term.hasSelection()),
      ).dispose);
      cleanups.push(term.onBell(() => cbRef.current.onBell?.()).dispose);

      const socket = getSocket();
      cbRef.current.onStatus?.('connecting');

      socket.emit(
        'terminal:create',
        { cols: term.cols, rows: term.rows, cwd },
        (res: { success?: boolean; terminalId?: string; error?: string }) => {
          if (cancelled || disposedRef.current) {
            // Raced against unmount: kill the PTY we just asked for rather than
            // orphaning a root shell on the server.
            if (res?.terminalId) socket.emit('terminal:destroy', { terminalId: res.terminalId });
            return;
          }
          if (!res?.success || !res.terminalId) {
            cbRef.current.onStatus?.('exited', res?.error || 'Failed to start shell');
            term.writeln(`\r\n\x1b[31m Could not start shell: ${res?.error || 'unknown error'}\x1b[0m`);
            return;
          }

          const tid = res.terminalId;
          terminalIdRef.current = tid;
          cbRef.current.onStatus?.('ready');

          /**
           * Apply any modifier armed on the mobile key bar.
           *
           * Letters typed on the phone's own keyboard arrive here, NOT through
           * the key bar's buttons — so arming Ctrl and then tapping `c` used to
           * send a literal "c". That made it impossible to interrupt a running
           * process from a phone, which is the single most important thing a
           * server terminal has to do.
           */
          const applyMods = (d: string): string => {
            const m = cbRef.current.mods?.current;
            if (!m || (m.ctrl === 'off' && m.alt === 'off')) return d;
            if (d.length !== 1) return d; // never rewrite escape sequences or pastes
            let out = d;
            if (m.ctrl !== 'off') {
              const b = ctrlByte(d);
              if (b) out = b;
            }
            if (m.alt !== 'off') out = '\x1b' + out;
            if (out !== d) cbRef.current.onModsUsed?.();
            return out;
          };

          cleanups.push(term.onData(d => socket.emit('terminal:input', { terminalId: tid, input: applyMods(d) })).dispose);
          cleanups.push(term.onResize(({ cols, rows }) =>
            socket.emit('terminal:resize', { terminalId: tid, cols, rows }),
          ).dispose);

          // Scoped to this pane's id, and — unlike before — actually removed.
          const onData = (p: { terminalId: string; data: string }) => {
            if (p.terminalId === tid) term.write(p.data);
          };
          const onExit = (p: { terminalId: string; code: number }) => {
            if (p.terminalId !== tid) return;
            terminalIdRef.current = null;
            cbRef.current.onStatus?.('exited', `Process exited with code ${p.code}`);
            term.writeln(`\r\n\x1b[90m Process exited (${p.code}) \x1b[0m`);
          };
          const onDisconnect = () => cbRef.current.onStatus?.('disconnected');
          const onConnect = () => {
            // The PTY is bound to the previous socket id server-side, so a
            // reconnect cannot resume it. Say so plainly instead of leaving a
            // dead black rectangle with no explanation.
            cbRef.current.onStatus?.('disconnected', 'Reconnected — start a new session');
          };

          socket.on('terminal:data', onData);
          socket.on('terminal:exit', onExit);
          socket.on('disconnect', onDisconnect);
          socket.on('connect', onConnect);

          cleanups.push(() => {
            socket.off('terminal:data', onData);
            socket.off('terminal:exit', onExit);
            socket.off('disconnect', onDisconnect);
            socket.off('connect', onConnect);
            socket.emit('terminal:destroy', { terminalId: tid });
          });

          setBooted(true);
          term.focus();
        },
      );

      // WebGL renderer: the DOM renderer repaints every cell as an element and
      // visibly stutters on fast output (a build log, `journalctl -f`).
      //
      // This is loaded *after* the PTY request is dispatched, deliberately.
      // It previously sat above the emit, which gated starting the user's
      // shell behind a purely cosmetic download — if the chunk stalled, the
      // terminal mounted, sized correctly, and then hung on "connecting"
      // forever because the create request was never sent. A renderer upgrade
      // must never be on the critical path to a working shell.
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl');
        if (cancelled || disposedRef.current) return;
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        /* canvas/DOM fallback is fine — WebGL is absent on some mobile
           browsers and with hardware acceleration disabled */
      }
    })();

    return () => {
      cancelled = true;
      disposedRef.current = true;
      for (const fn of cleanups) { try { fn(); } catch { /* already gone */ } }
      try { termRef.current?.dispose(); } catch { /* already gone */ }
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
    // Intentionally mount-only. fontSize/scrollback are applied imperatively
    // below; rebuilding the terminal would kill the user's shell session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    try { fitRef.current?.fit(); } catch { /* not laid out */ }
  }, [fontSize, booted]);

  const doFit = useCallback(() => {
    try { fitRef.current?.fit(); } catch { /* not laid out */ }
  }, []);

  useImperativeHandle(ref, (): TerminalPaneHandle => ({
    focus: () => termRef.current?.focus(),
    fit: doFit,
    write: d => termRef.current?.write(d),
    send: d => {
      const tid = terminalIdRef.current;
      if (tid) getSocket().emit('terminal:input', { terminalId: tid, input: d });
      termRef.current?.scrollToBottom();
    },
    clear: () => termRef.current?.clear(),
    search: (q, dir) => {
      const s = searchRef.current;
      if (!s || !q) return false;
      const opts = {
        decorations: {
          matchBackground: 'rgba(245,158,11,0.35)',
          activeMatchBackground: 'rgba(20,184,166,0.55)',
          matchOverviewRuler: '#f59e0b',
          activeMatchColorOverviewRuler: '#14b8a6',
        },
      };
      return dir === 'next' ? s.findNext(q, opts) : s.findPrevious(q, opts);
    },
    clearSearch: () => searchRef.current?.clearDecorations(),
    copySelection: async () => {
      const term = termRef.current;
      if (!term || !term.hasSelection()) return false;
      const text = term.getSelection();
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    },
    paste: async () => {
      const tid = terminalIdRef.current;
      if (!tid) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text) getSocket().emit('terminal:input', { terminalId: tid, input: text });
      } catch {
        /* clipboard permission denied — the key bar surfaces the failure */
      }
    },
    setFontSize: px => {
      const term = termRef.current;
      if (!term) return;
      term.options.fontSize = px;
      doFit();
    },
    scrollToBottom: () => termRef.current?.scrollToBottom(),
    hasSelection: () => termRef.current?.hasSelection() ?? false,
  }), [doFit]);

  return (
    <div className="absolute inset-0" style={{ background: TERM_BG }}>
      {/* Real padding: the prompt was flush against the screen edge on mobile,
          which is the cheapest possible tell that a layout was never checked
          on a phone. */}
      <div ref={hostRef} className="w-full h-full px-3 py-2 max-md:px-3" />
    </div>
  );
});

export default TerminalPane;
