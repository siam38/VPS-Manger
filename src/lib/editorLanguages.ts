import { StreamLanguage } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

/**
 * Language resolution for the editor.
 *
 * Every grammar is loaded dynamically so none of them land in the initial
 * bundle. Monaco used to be pulled from a CDN as a ~4MB blob regardless of
 * what you opened; here you pay only for the language you actually edit.
 */

export interface LangInfo {
  /** Display label shown in the status bar. */
  label: string;
  /** Loader, or null for plain text. */
  load: (() => Promise<Extension>) | null;
}

const js = (jsx: boolean, typescript: boolean) => () =>
  import('@codemirror/lang-javascript').then(m => m.javascript({ jsx, typescript }));

const legacy = (name: string) => () =>
  import('@codemirror/legacy-modes/mode/' + name).then((m: any) => {
    // Legacy mode files export one or more parsers; pick the requested one
    // when present, otherwise the first parser-shaped export.
    const key = name.split('/').pop() as string;
    const mode = m[key] || Object.values(m).find((v: any) => v && typeof v.token === 'function');
    return StreamLanguage.define(mode as any);
  });

const REGISTRY: Record<string, LangInfo> = {
  // ── JS/TS family ────────────────────────────────────────────────
  js: { label: 'JavaScript', load: js(true, false) },
  mjs: { label: 'JavaScript', load: js(true, false) },
  cjs: { label: 'JavaScript', load: js(true, false) },
  jsx: { label: 'JSX', load: js(true, false) },
  ts: { label: 'TypeScript', load: js(false, true) },
  mts: { label: 'TypeScript', load: js(false, true) },
  cts: { label: 'TypeScript', load: js(false, true) },
  tsx: { label: 'TSX', load: js(true, true) },

  // ── Web ─────────────────────────────────────────────────────────
  html: { label: 'HTML', load: () => import('@codemirror/lang-html').then(m => m.html()) },
  htm: { label: 'HTML', load: () => import('@codemirror/lang-html').then(m => m.html()) },
  vue: { label: 'Vue', load: () => import('@codemirror/lang-html').then(m => m.html()) },
  svelte: { label: 'Svelte', load: () => import('@codemirror/lang-html').then(m => m.html()) },
  css: { label: 'CSS', load: () => import('@codemirror/lang-css').then(m => m.css()) },
  scss: { label: 'SCSS', load: () => import('@codemirror/lang-css').then(m => m.css()) },
  sass: { label: 'Sass', load: () => import('@codemirror/lang-css').then(m => m.css()) },
  less: { label: 'Less', load: () => import('@codemirror/lang-css').then(m => m.css()) },

  // ── Data / config ───────────────────────────────────────────────
  json: { label: 'JSON', load: () => import('@codemirror/lang-json').then(m => m.json()) },
  jsonc: { label: 'JSON', load: () => import('@codemirror/lang-json').then(m => m.json()) },
  yaml: { label: 'YAML', load: () => import('@codemirror/lang-yaml').then(m => m.yaml()) },
  yml: { label: 'YAML', load: () => import('@codemirror/lang-yaml').then(m => m.yaml()) },
  xml: { label: 'XML', load: () => import('@codemirror/lang-xml').then(m => m.xml()) },
  svg: { label: 'SVG', load: () => import('@codemirror/lang-xml').then(m => m.xml()) },
  sql: { label: 'SQL', load: () => import('@codemirror/lang-sql').then(m => m.sql()) },
  toml: { label: 'TOML', load: legacy('toml') },
  ini: { label: 'INI', load: legacy('properties') },
  cfg: { label: 'INI', load: legacy('properties') },
  conf: { label: 'Config', load: legacy('properties') },
  env: { label: 'Dotenv', load: legacy('properties') },
  properties: { label: 'Properties', load: legacy('properties') },

  // ── Docs ────────────────────────────────────────────────────────
  md: { label: 'Markdown', load: () => import('@codemirror/lang-markdown').then(m => m.markdown()) },
  mdx: { label: 'Markdown', load: () => import('@codemirror/lang-markdown').then(m => m.markdown()) },
  markdown: { label: 'Markdown', load: () => import('@codemirror/lang-markdown').then(m => m.markdown()) },

  // ── Systems / general ───────────────────────────────────────────
  py: { label: 'Python', load: () => import('@codemirror/lang-python').then(m => m.python()) },
  pyw: { label: 'Python', load: () => import('@codemirror/lang-python').then(m => m.python()) },
  rs: { label: 'Rust', load: () => import('@codemirror/lang-rust').then(m => m.rust()) },
  go: { label: 'Go', load: () => import('@codemirror/lang-go').then(m => m.go()) },
  php: { label: 'PHP', load: () => import('@codemirror/lang-php').then(m => m.php()) },
  java: { label: 'Java', load: () => import('@codemirror/lang-java').then(m => m.java()) },
  c: { label: 'C', load: () => import('@codemirror/lang-cpp').then(m => m.cpp()) },
  h: { label: 'C header', load: () => import('@codemirror/lang-cpp').then(m => m.cpp()) },
  cpp: { label: 'C++', load: () => import('@codemirror/lang-cpp').then(m => m.cpp()) },
  cc: { label: 'C++', load: () => import('@codemirror/lang-cpp').then(m => m.cpp()) },
  hpp: { label: 'C++ header', load: () => import('@codemirror/lang-cpp').then(m => m.cpp()) },

  // ── Legacy stream modes ─────────────────────────────────────────
  sh: { label: 'Shell', load: legacy('shell') },
  bash: { label: 'Shell', load: legacy('shell') },
  zsh: { label: 'Shell', load: legacy('shell') },
  fish: { label: 'Shell', load: legacy('shell') },
  rb: { label: 'Ruby', load: legacy('ruby') },
  lua: { label: 'Lua', load: legacy('lua') },
  pl: { label: 'Perl', load: legacy('perl') },
  r: { label: 'R', load: legacy('r') },
  swift: { label: 'Swift', load: legacy('swift') },
  cs: { label: 'C#', load: legacy('clike') },
  kt: { label: 'Kotlin', load: legacy('clike') },
  scala: { label: 'Scala', load: legacy('clike') },
  diff: { label: 'Diff', load: legacy('diff') },
  patch: { label: 'Diff', load: legacy('diff') },
  dockerfile: { label: 'Dockerfile', load: legacy('dockerfile') },
  nginx: { label: 'Nginx', load: legacy('nginx') },
  makefile: { label: 'Makefile', load: null },
  log: { label: 'Log', load: null },
  txt: { label: 'Plain text', load: null },
};

/** Filenames with no useful extension. */
const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  'docker-compose.yml': 'yaml',
  makefile: 'makefile',
  rakefile: 'rb',
  gemfile: 'rb',
  '.env': 'env',
  '.gitignore': 'properties',
  '.dockerignore': 'properties',
  '.npmrc': 'properties',
  '.editorconfig': 'ini',
  '.bashrc': 'sh',
  '.zshrc': 'sh',
  '.profile': 'sh',
  'nginx.conf': 'nginx',
  license: 'txt',
  readme: 'md',
  changelog: 'md',
};

const PLAIN: LangInfo = { label: 'Plain text', load: null };

export function resolveLanguage(fileName: string): LangInfo {
  const lower = fileName.toLowerCase();

  const byName = BY_NAME[lower];
  if (byName) return REGISTRY[byName] || PLAIN;

  // `.env.production`, `.bashrc.local`, etc.
  for (const key of Object.keys(BY_NAME)) {
    if (key.startsWith('.') && lower.startsWith(key + '.')) {
      return REGISTRY[BY_NAME[key]] || PLAIN;
    }
  }

  const ext = lower.includes('.') ? lower.split('.').pop()! : '';
  return REGISTRY[ext] || PLAIN;
}

export function languageLabel(fileName: string): string {
  return resolveLanguage(fileName).label;
}
