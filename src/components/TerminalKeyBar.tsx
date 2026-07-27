import React, { useState } from 'react';
import {
  CornerDownLeft, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
} from 'lucide-react';
import {
  ctrlByte, KEY_ESC, KEY_TAB, KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT,
  KEY_HOME, KEY_END, KEY_PGUP, KEY_PGDN,
} from '../lib/termTheme';

/**
 * Mobile key bar.
 *
 * A phone's virtual keyboard has no Ctrl, Esc, Tab, arrows or pipe. Without
 * these a mobile terminal can echo text and nothing else — you cannot break a
 * running process, complete a path, or recall history. This is the same
 * problem the editor's key bar solved, and the same fix.
 *
 * Modifiers are *sticky*: tap Ctrl, then C, and `^C` is sent. That is the only
 * workable model on a touch screen, where chording is impossible. Double-tap
 * locks a modifier on until tapped off, for sequences like Ctrl+A then Ctrl+K.
 */

interface Props {
  onKey: (data: string) => void;
  onPaste: () => void;
}

type Mod = 'ctrl' | 'alt';

const QUICK_CHARS = ['|', '~', '/', '-', '_', '$', '*', '&', '"', "'", '`', '{', '}', '[', ']', '(', ')', '<', '>', '#', '!', '=', '+', ';', ':', '?', '\\', '%', '@', '.'];

export default function TerminalKeyBar({ onKey, onPaste }: Props) {
  // 'off' | 'once' (consumed by next key) | 'lock' (stays until tapped off)
  const [ctrl, setCtrl] = useState<'off' | 'once' | 'lock'>('off');
  const [alt, setAlt] = useState<'off' | 'once' | 'lock'>('off');

  const cycle = (cur: 'off' | 'once' | 'lock'): 'off' | 'once' | 'lock' =>
    cur === 'off' ? 'once' : cur === 'once' ? 'lock' : 'off';

  const consume = (mod: Mod) => {
    if (mod === 'ctrl') setCtrl(c => (c === 'once' ? 'off' : c));
    else setAlt(a => (a === 'once' ? 'off' : a));
  };

  /** Applies any pending modifiers to a literal character. */
  const sendChar = (ch: string) => {
    if (ctrl !== 'off') {
      const b = ctrlByte(ch);
      if (b) {
        onKey(b);
        consume('ctrl');
        consume('alt');
        return;
      }
    }
    if (alt !== 'off') {
      onKey('\x1b' + ch); // Alt is transmitted as ESC-prefix
      consume('alt');
      consume('ctrl');
      return;
    }
    onKey(ch);
  };

  const sendRaw = (seq: string) => {
    onKey(seq);
    consume('ctrl');
    consume('alt');
  };

  /**
   * Without this the editor/terminal loses focus on every tap and the virtual
   * keyboard collapses after each press. Do not remove it.
   */
  const hold = (e: React.MouseEvent | React.TouchEvent) => e.preventDefault();

  const modClass = (s: 'off' | 'once' | 'lock') =>
    s === 'lock'
      ? 'bg-accent text-canvas shadow-btn'
      : s === 'once'
        ? 'bg-accent/20 text-accent border-accent/40'
        : 'bg-raised text-ink border-line';

  const keyBase =
    'shrink-0 h-9 min-w-[2.25rem] px-2 rounded-control border border-line ' +
    'bg-raised text-ink text-meta font-mono ' +
    'active:bg-accent/25 active:border-accent/40 transition-colors ' +
    'flex items-center justify-center select-none';

  return (
    <div
      className="md:hidden border-t border-line bg-surface"
      // Keeps the bar above the virtual keyboard on iOS Safari.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Row 1: modifiers, navigation, the keys you cannot otherwise produce */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-none">
        <button
          onMouseDown={hold}
          onClick={() => setCtrl(cycle)}
          aria-pressed={ctrl !== 'off'}
          aria-label="Control modifier"
          className={`${keyBase} font-sans font-semibold ${modClass(ctrl)}`}
        >
          Ctrl
        </button>
        <button
          onMouseDown={hold}
          onClick={() => setAlt(cycle)}
          aria-pressed={alt !== 'off'}
          aria-label="Alt modifier"
          className={`${keyBase} font-sans font-semibold ${modClass(alt)}`}
        >
          Alt
        </button>

        <span className="w-px h-5 bg-line shrink-0" aria-hidden />

        <button onMouseDown={hold} onClick={() => sendRaw(KEY_ESC)} className={`${keyBase} font-sans`} aria-label="Escape">Esc</button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_TAB)} className={`${keyBase} font-sans`} aria-label="Tab">Tab</button>

        <span className="w-px h-5 bg-line shrink-0" aria-hidden />

        <button onMouseDown={hold} onClick={() => sendRaw(KEY_UP)} className={keyBase} aria-label="Arrow up"><ArrowUp className="w-4 h-4" strokeWidth={1.75} /></button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_DOWN)} className={keyBase} aria-label="Arrow down"><ArrowDown className="w-4 h-4" strokeWidth={1.75} /></button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_LEFT)} className={keyBase} aria-label="Arrow left"><ArrowLeft className="w-4 h-4" strokeWidth={1.75} /></button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_RIGHT)} className={keyBase} aria-label="Arrow right"><ArrowRight className="w-4 h-4" strokeWidth={1.75} /></button>

        <span className="w-px h-5 bg-line shrink-0" aria-hidden />

        {/* Ctrl+C is the single most-needed key on a server terminal, so it
            gets a dedicated button rather than requiring a two-tap chord. */}
        <button
          onMouseDown={hold}
          onClick={() => onKey('\x03')}
          className={`${keyBase} font-sans text-danger border-danger/30`}
          aria-label="Send interrupt, Control C"
        >
          ^C
        </button>
        <button onMouseDown={hold} onClick={() => onKey('\x04')} className={`${keyBase} font-sans`} aria-label="Send end of file, Control D">^D</button>
        <button onMouseDown={hold} onClick={() => onKey('\x0c')} className={`${keyBase} font-sans`} aria-label="Clear screen, Control L">^L</button>
        <button onMouseDown={hold} onClick={() => onKey('\x1a')} className={`${keyBase} font-sans`} aria-label="Suspend, Control Z">^Z</button>

        <span className="w-px h-5 bg-line shrink-0" aria-hidden />

        <button onMouseDown={hold} onClick={() => sendRaw(KEY_HOME)} className={`${keyBase} font-sans`} aria-label="Home">Home</button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_END)} className={`${keyBase} font-sans`} aria-label="End">End</button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_PGUP)} className={`${keyBase} font-sans`} aria-label="Page up">PgUp</button>
        <button onMouseDown={hold} onClick={() => sendRaw(KEY_PGDN)} className={`${keyBase} font-sans`} aria-label="Page down">PgDn</button>

        <span className="w-px h-5 bg-line shrink-0" aria-hidden />

        <button onMouseDown={hold} onClick={onPaste} className={`${keyBase} font-sans px-2.5`} aria-label="Paste from clipboard">Paste</button>
        <button onMouseDown={hold} onClick={() => onKey('\r')} className={`${keyBase} px-2.5`} aria-label="Enter"><CornerDownLeft className="w-4 h-4" strokeWidth={1.75} /></button>
      </div>

      {/* Row 2: punctuation. Buried behind two menus on a phone keyboard, and
          unusable for shell work at that depth. */}
      <div className="flex items-center gap-1 px-2 pb-1.5 overflow-x-auto scrollbar-none">
        {QUICK_CHARS.map(ch => (
          <button
            key={ch}
            onMouseDown={hold}
            onClick={() => sendChar(ch)}
            className="shrink-0 w-8 h-8 rounded-chip bg-canvas border border-line/70 text-meta font-mono text-subtle active:bg-accent/25 active:text-ink transition-colors flex items-center justify-center"
            aria-label={`Insert ${ch}`}
          >
            {ch}
          </button>
        ))}
      </div>
    </div>
  );
}
