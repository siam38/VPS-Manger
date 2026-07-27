import React from 'react';
import {
  CornerDownLeft, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ClipboardPaste,
} from 'lucide-react';
import {
  ctrlByte, KEY_ESC, KEY_TAB, KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT,
} from '../lib/termTheme';

/**
 * Mobile key bar.
 *
 * A phone's virtual keyboard has no Ctrl, Esc, Tab, arrows or pipe. Without
 * these a mobile terminal can echo text and nothing else — you cannot break a
 * running process, complete a path, or recall history. Same problem the editor
 * had, same fix.
 *
 * Layout rules learned from review:
 *  - Nothing scrolls horizontally on the primary row. The first version put
 *    Ctrl+C — the single most important key on a server — off the right edge
 *    of a scroll container, which is worse than omitting it.
 *  - Keys are a fixed grid, not content-width. Content-width buttons produced
 *    a ransom-note row of eight different widths.
 *  - Arrows are the highest-frequency keys (shell history, cursor movement) so
 *    they get full-size targets rather than the smallest ones.
 *  - The bar has real horizontal padding; the punctuation row was previously
 *    clipped against both screen edges.
 */

export type ModState = 'off' | 'once' | 'lock';

interface Props {
  onKey: (data: string) => void;
  onPaste: () => void;
  /**
   * Modifier state is owned by the page, not by this component.
   *
   * It has to be shared: characters typed on the phone's *own* keyboard never
   * pass through these buttons, they go straight into xterm. If Ctrl lived
   * only in here, arming it and then typing `c` would send a literal "c" and
   * you could never interrupt a running process from a phone.
   */
  ctrl: ModState;
  alt: ModState;
  setCtrl: React.Dispatch<React.SetStateAction<ModState>>;
  setAlt: React.Dispatch<React.SetStateAction<ModState>>;
}

/** Trimmed from 30 to the characters that actually matter in a shell, so each
 *  target clears ~40px instead of ~28px. */
const QUICK_CHARS = ['|', '/', '-', '_', '~', '$', '.', ':', '*', '"', "'", '>', '&', '\\', '{', '}', '[', ']', '(', ')', '#', '!', '=', '?', '+', ';', '@', '%'];

export default function TerminalKeyBar({ onKey, onPaste, ctrl, alt, setCtrl, setAlt }: Props) {

  // off -> once (next key only) -> lock (until tapped off). Chording is
  // impossible on a touch screen, so modifiers must be sticky.
  const cycle = (c: ModState): ModState => (c === 'off' ? 'once' : c === 'once' ? 'lock' : 'off');

  const consume = () => {
    setCtrl(c => (c === 'once' ? 'off' : c));
    setAlt(a => (a === 'once' ? 'off' : a));
  };

  const sendChar = (ch: string) => {
    if (ctrl !== 'off') {
      const b = ctrlByte(ch);
      if (b) { onKey(b); consume(); return; }
    }
    if (alt !== 'off') { onKey('\x1b' + ch); consume(); return; }
    onKey(ch);
  };

  const sendRaw = (seq: string) => { onKey(seq); consume(); };

  /** Without this the terminal loses focus on every tap and the virtual
   *  keyboard collapses after each press. Do not remove it. */
  const hold = (e: React.MouseEvent) => e.preventDefault();

  // 44px minimum touch target, uniform width, consistent radius and weight.
  const key =
    'h-11 rounded-control border border-line bg-raised text-ink text-meta font-medium ' +
    'flex items-center justify-center select-none ' +
    'active:bg-accent/30 active:border-accent/50 active:scale-[0.96] ' +
    'transition-[background-color,border-color,transform] duration-100';

  const modClass = (s: ModState) =>
    s === 'lock'
      ? 'bg-accent text-canvas border-accent shadow-btn'
      : s === 'once'
        ? 'bg-accent/25 text-accent border-accent/50'
        : 'bg-raised text-ink border-line';

  return (
    <div
      className="md:hidden border-t border-line bg-surface px-2 pt-2"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
    >
      {/* Row 1 — everything critical, all on screen, no horizontal scroll. */}
      <div className="grid grid-cols-8 gap-1.5">
        <button
          onMouseDown={hold} onClick={() => setCtrl(cycle)}
          aria-pressed={ctrl !== 'off'} aria-label="Control modifier"
          className={`${key} ${modClass(ctrl)}`}
        >Ctrl</button>
        <button
          onMouseDown={hold} onClick={() => setAlt(cycle)}
          aria-pressed={alt !== 'off'} aria-label="Alt modifier"
          className={`${key} ${modClass(alt)}`}
        >Alt</button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_ESC)} className={key} aria-label="Escape">Esc</button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_TAB)} className={key} aria-label="Tab">Tab</button>

        {/* Ctrl+C is the most-reached-for key on a server terminal. It gets a
            fixed, always-visible slot and the only semantic colour here. */}
        <button
          onMouseDown={hold} onClick={() => { onKey('\x03'); consume(); }}
          className={`${key} bg-danger/10 text-danger border-danger/30 font-mono`}
          aria-label="Send interrupt, Control C"
        >^C</button>
        <button onMouseDown={hold} onClick={() => { onKey('\x04'); consume(); }} className={`${key} font-mono`} aria-label="Send end of file, Control D">^D</button>
        <button onMouseDown={hold} onClick={() => { onKey('\x0c'); consume(); }} className={`${key} font-mono`} aria-label="Clear screen, Control L">^L</button>
        <button onMouseDown={hold} onClick={onPaste} className={key} aria-label="Paste from clipboard">
          <ClipboardPaste className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Row 2 — arrows get full-size targets; they drive shell history. */}
      <div className="grid grid-cols-8 gap-1.5 mt-1.5">
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_LEFT)} className={`${key} col-span-1`} aria-label="Arrow left"><ArrowLeft className="w-4 h-4" strokeWidth={2} /></button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_DOWN)} className={`${key} col-span-1`} aria-label="Arrow down"><ArrowDown className="w-4 h-4" strokeWidth={2} /></button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_UP)} className={`${key} col-span-1`} aria-label="Arrow up"><ArrowUp className="w-4 h-4" strokeWidth={2} /></button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_RIGHT)} className={`${key} col-span-1`} aria-label="Arrow right"><ArrowRight className="w-4 h-4" strokeWidth={2} /></button>
        <button onMouseDown={hold} onClick={() => sendChar('|')} className={`${key} font-mono`} aria-label="Insert pipe">|</button>
        <button onMouseDown={hold} onClick={() => sendChar('/')} className={`${key} font-mono`} aria-label="Insert slash">/</button>
        <button onMouseDown={hold} onClick={() => sendChar('-')} className={`${key} font-mono`} aria-label="Insert hyphen">-</button>
        <button
          onMouseDown={hold} onClick={() => { onKey('\r'); consume(); }}
          className={`${key} bg-accent/15 text-accent border-accent/40`} aria-label="Enter"
        ><CornerDownLeft className="w-4 h-4" strokeWidth={2} /></button>
      </div>

      {/* Row 3 — punctuation. Scrollable by design, but padded so no key is
          clipped against a screen edge, and faded to signal more content. */}
      <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto scrollbar-none mask-fade-l">
        {QUICK_CHARS.map(ch => (
          <button
            key={ch}
            onMouseDown={hold}
            onClick={() => sendChar(ch)}
            className="shrink-0 w-10 h-10 rounded-control bg-canvas border border-line/70 text-meta font-mono text-subtle active:bg-accent/25 active:text-ink active:scale-[0.96] transition-[background-color,transform] duration-100 flex items-center justify-center"
            aria-label={`Insert ${ch}`}
          >
            {ch}
          </button>
        ))}
      </div>
    </div>
  );
}
