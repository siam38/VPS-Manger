/**
 * xterm theme + shared terminal constants.
 *
 * Derived from the panel's own design tokens (tailwind.config.js) rather than
 * importing a stock scheme, for the same reason the CodeMirror theme is:
 * a terminal sitting inside this shell should look like part of it.
 *
 * ANSI colours stay recognisable — red is red, green is green — because users
 * read `ls` output and diff colours by muscle memory. Only the chrome
 * (background, cursor, selection) is tuned to the panel.
 */

export const TERM_BG = '#070d0d'; // canvas

export const termTheme = {
  background: TERM_BG,
  foreground: '#e8f2f0', // ink
  cursor: '#14b8a6', // accent — interaction colour, correct usage
  cursorAccent: TERM_BG,
  selectionBackground: 'rgba(20,184,166,0.28)',
  selectionForeground: '#f0fdfa',
  selectionInactiveBackground: 'rgba(125,161,156,0.18)',

  black: '#0d1917',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#f59e0b',
  blue: '#06b6d4',
  magenta: '#a855f7',
  cyan: '#14b8a6',
  white: '#d6e7e5',

  brightBlack: '#5a7f7b', // was #3d5955 — unreadable for dimmed output
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#fbbf24',
  brightBlue: '#22d3ee',
  brightMagenta: '#c084fc',
  brightCyan: '#2dd4bf',
  brightWhite: '#f0fdfa',
};

/** Font size bounds. Persisted per-user, not hardcoded at 14 like before. */
export const FONT_MIN = 10;
export const FONT_MAX = 22;
export const FONT_DEFAULT = 14;

export const SCROLLBACK_DEFAULT = 5000;

const LS_PREFIX = 'vps_term_';

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode / quota — preferences are not worth throwing over */
  }
}

/**
 * Control-character helpers.
 *
 * A phone keyboard cannot produce Ctrl+C, Esc, Tab or arrow keys, which makes
 * a mobile terminal decorative rather than usable. These map the key bar's
 * buttons to the bytes a PTY actually expects.
 */
export const CTRL_SEQ: Record<string, string> = {
  a: '\x01', b: '\x02', c: '\x03', d: '\x04', e: '\x05', f: '\x06',
  g: '\x07', h: '\x08', i: '\x09', j: '\x0a', k: '\x0b', l: '\x0c',
  m: '\x0d', n: '\x0e', o: '\x0f', p: '\x10', q: '\x11', r: '\x12',
  s: '\x13', t: '\x14', u: '\x15', v: '\x16', w: '\x17', x: '\x18',
  y: '\x19', z: '\x1a',
};

export function ctrlByte(letter: string): string | null {
  return CTRL_SEQ[letter.toLowerCase()] ?? null;
}

export const KEY_ESC = '\x1b';
export const KEY_TAB = '\t';
export const KEY_UP = '\x1b[A';
export const KEY_DOWN = '\x1b[B';
export const KEY_RIGHT = '\x1b[C';
export const KEY_LEFT = '\x1b[D';
export const KEY_HOME = '\x1b[H';
export const KEY_END = '\x1b[F';
export const KEY_PGUP = '\x1b[5~';
export const KEY_PGDN = '\x1b[6~';
