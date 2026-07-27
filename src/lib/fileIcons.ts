import {
  Binary, Box, Braces, Brackets, Coffee, Cog, Container, Database, FileArchive,
  FileAudio, FileCode2, FileImage, FileJson2, FileLock2, FileSpreadsheet,
  FileTerminal, FileText, FileType2, FileVideo, FileWarning, Folder, FolderGit2,
  FolderLock, GitBranch, Globe, Hash, KeyRound, Palette, PanelsTopLeft, Rss,
  ScrollText, Shield, Sigma, Table2, Type, Workflow,
} from 'lucide-react';

/**
 * File icon + colour system, VS Code style.
 *
 * The old map collapsed most of the language ecosystem into a single
 * `FileCode` glyph: .js, .ts, .py, .go, .rs, .css and .vue were literally the
 * same icon, so a directory listing gave you no scanning signal at all. Here
 * every meaningful family gets a distinct glyph *and* a distinct hue, matched
 * to the colours people already associate with each language (JS yellow,
 * TS blue, Go cyan, Rust orange, Python blue/green, and so on).
 *
 * Rule kept from the design pass: folders use the accent, everything else uses
 * its own hue at a muted weight so the list still reads as one surface.
 */

export interface IconSpec {
  Icon: any;
  /** Tailwind text colour class. */
  color: string;
}

const C = {
  js: 'text-[#e8c34a]',
  ts: 'text-[#4a9eea]',
  json: 'text-[#e8c34a]',
  html: 'text-[#e8873c]',
  css: 'text-[#4a9eea]',
  sass: 'text-[#e07ba8]',
  py: 'text-[#5aa9dc]',
  rb: 'text-[#e0555a]',
  go: 'text-[#4fc4d6]',
  rs: 'text-[#e8894a]',
  java: 'text-[#e0703c]',
  php: 'text-[#8b8fd4]',
  c: 'text-[#6f9fd8]',
  cs: 'text-[#8b5fc4]',
  swift: 'text-[#e8724a]',
  shell: 'text-[#6cc98a]',
  md: 'text-[#7da3c9]',
  yaml: 'text-[#d47ba8]',
  xml: 'text-[#8fbf7f]',
  sql: 'text-[#5fb8d0]',
  img: 'text-[#c58fd8]',
  video: 'text-[#d4708c]',
  audio: 'text-[#6fc99a]',
  archive: 'text-[#d8a85f]',
  pdf: 'text-[#e0625a]',
  doc: 'text-[#5a8fd0]',
  sheet: 'text-[#5aab72]',
  lock: 'text-[#c9705f]',
  key: 'text-[#d8b45f]',
  git: 'text-[#e8734a]',
  docker: 'text-[#5a9fe0]',
  config: 'text-[#9aa8a5]',
  text: 'text-[#8fa3a0]',
  binary: 'text-[#7d8f8c]',
  vue: 'text-[#5fc48f]',
  react: 'text-[#5fc4dc]',
  neutral: 'text-muted/70',
};

const EXT: Record<string, IconSpec> = {
  // ── JavaScript / TypeScript ──────────────────────────────────────
  js: { Icon: FileCode2, color: C.js },
  mjs: { Icon: FileCode2, color: C.js },
  cjs: { Icon: FileCode2, color: C.js },
  jsx: { Icon: Braces, color: C.react },
  ts: { Icon: FileCode2, color: C.ts },
  mts: { Icon: FileCode2, color: C.ts },
  cts: { Icon: FileCode2, color: C.ts },
  tsx: { Icon: Braces, color: C.react },

  // ── Data / config ────────────────────────────────────────────────
  json: { Icon: FileJson2, color: C.json },
  jsonc: { Icon: FileJson2, color: C.json },
  json5: { Icon: FileJson2, color: C.json },
  yaml: { Icon: Workflow, color: C.yaml },
  yml: { Icon: Workflow, color: C.yaml },
  toml: { Icon: Cog, color: C.config },
  xml: { Icon: Brackets, color: C.xml },
  csv: { Icon: Table2, color: C.sheet },
  tsv: { Icon: Table2, color: C.sheet },
  ini: { Icon: Cog, color: C.config },
  cfg: { Icon: Cog, color: C.config },
  conf: { Icon: Cog, color: C.config },
  config: { Icon: Cog, color: C.config },
  properties: { Icon: Cog, color: C.config },
  env: { Icon: FileLock2, color: C.key },
  plist: { Icon: Cog, color: C.config },

  // ── Web ──────────────────────────────────────────────────────────
  html: { Icon: Globe, color: C.html },
  htm: { Icon: Globe, color: C.html },
  css: { Icon: Palette, color: C.css },
  scss: { Icon: Palette, color: C.sass },
  sass: { Icon: Palette, color: C.sass },
  less: { Icon: Palette, color: C.sass },
  styl: { Icon: Palette, color: C.sass },
  vue: { Icon: PanelsTopLeft, color: C.vue },
  svelte: { Icon: PanelsTopLeft, color: C.html },
  astro: { Icon: PanelsTopLeft, color: C.js },

  // ── Languages ────────────────────────────────────────────────────
  py: { Icon: FileCode2, color: C.py },
  pyw: { Icon: FileCode2, color: C.py },
  pyi: { Icon: FileCode2, color: C.py },
  rb: { Icon: FileCode2, color: C.rb },
  go: { Icon: FileCode2, color: C.go },
  rs: { Icon: Cog, color: C.rs },
  java: { Icon: Coffee, color: C.java },
  kt: { Icon: Coffee, color: C.cs },
  kts: { Icon: Coffee, color: C.cs },
  scala: { Icon: Coffee, color: C.rb },
  c: { Icon: FileCode2, color: C.c },
  h: { Icon: FileCode2, color: C.c },
  cc: { Icon: FileCode2, color: C.c },
  cpp: { Icon: FileCode2, color: C.c },
  hpp: { Icon: FileCode2, color: C.c },
  cs: { Icon: Hash, color: C.cs },
  php: { Icon: FileCode2, color: C.php },
  swift: { Icon: FileCode2, color: C.swift },
  dart: { Icon: FileCode2, color: C.ts },
  lua: { Icon: FileCode2, color: C.ts },
  pl: { Icon: FileCode2, color: C.php },
  r: { Icon: Sigma, color: C.c },
  ex: { Icon: FileCode2, color: C.cs },
  exs: { Icon: FileCode2, color: C.cs },
  hs: { Icon: Sigma, color: C.php },
  clj: { Icon: FileCode2, color: C.vue },
  groovy: { Icon: Coffee, color: C.java },
  m: { Icon: FileCode2, color: C.c },
  sql: { Icon: Database, color: C.sql },
  graphql: { Icon: Rss, color: C.sass },
  gql: { Icon: Rss, color: C.sass },
  proto: { Icon: Rss, color: C.go },
  prisma: { Icon: Database, color: C.vue },

  // ── Shell ────────────────────────────────────────────────────────
  sh: { Icon: FileTerminal, color: C.shell },
  bash: { Icon: FileTerminal, color: C.shell },
  zsh: { Icon: FileTerminal, color: C.shell },
  fish: { Icon: FileTerminal, color: C.shell },
  ps1: { Icon: FileTerminal, color: C.ts },
  bat: { Icon: FileTerminal, color: C.config },
  cmd: { Icon: FileTerminal, color: C.config },

  // ── Docs ─────────────────────────────────────────────────────────
  md: { Icon: FileText, color: C.md },
  mdx: { Icon: FileText, color: C.md },
  markdown: { Icon: FileText, color: C.md },
  txt: { Icon: FileText, color: C.text },
  rst: { Icon: FileText, color: C.text },
  tex: { Icon: FileText, color: C.text },
  adoc: { Icon: FileText, color: C.text },
  log: { Icon: ScrollText, color: C.neutral },
  pdf: { Icon: FileType2, color: C.pdf },
  doc: { Icon: FileText, color: C.doc },
  docx: { Icon: FileText, color: C.doc },
  rtf: { Icon: FileText, color: C.doc },
  odt: { Icon: FileText, color: C.doc },
  epub: { Icon: FileText, color: C.doc },
  xls: { Icon: FileSpreadsheet, color: C.sheet },
  xlsx: { Icon: FileSpreadsheet, color: C.sheet },
  ods: { Icon: FileSpreadsheet, color: C.sheet },
  ppt: { Icon: FileType2, color: C.html },
  pptx: { Icon: FileType2, color: C.html },

  // ── Media ────────────────────────────────────────────────────────
  png: { Icon: FileImage, color: C.img },
  jpg: { Icon: FileImage, color: C.img },
  jpeg: { Icon: FileImage, color: C.img },
  gif: { Icon: FileImage, color: C.img },
  webp: { Icon: FileImage, color: C.img },
  avif: { Icon: FileImage, color: C.img },
  bmp: { Icon: FileImage, color: C.img },
  ico: { Icon: FileImage, color: C.img },
  tiff: { Icon: FileImage, color: C.img },
  svg: { Icon: FileImage, color: C.vue },
  mp4: { Icon: FileVideo, color: C.video },
  mkv: { Icon: FileVideo, color: C.video },
  webm: { Icon: FileVideo, color: C.video },
  mov: { Icon: FileVideo, color: C.video },
  avi: { Icon: FileVideo, color: C.video },
  m4v: { Icon: FileVideo, color: C.video },
  mp3: { Icon: FileAudio, color: C.audio },
  wav: { Icon: FileAudio, color: C.audio },
  ogg: { Icon: FileAudio, color: C.audio },
  flac: { Icon: FileAudio, color: C.audio },
  aac: { Icon: FileAudio, color: C.audio },
  m4a: { Icon: FileAudio, color: C.audio },
  opus: { Icon: FileAudio, color: C.audio },

  // ── Archives / packages ──────────────────────────────────────────
  zip: { Icon: FileArchive, color: C.archive },
  tar: { Icon: FileArchive, color: C.archive },
  gz: { Icon: FileArchive, color: C.archive },
  tgz: { Icon: FileArchive, color: C.archive },
  bz2: { Icon: FileArchive, color: C.archive },
  xz: { Icon: FileArchive, color: C.archive },
  '7z': { Icon: FileArchive, color: C.archive },
  rar: { Icon: FileArchive, color: C.archive },
  iso: { Icon: Box, color: C.archive },
  dmg: { Icon: Box, color: C.archive },
  deb: { Icon: Box, color: C.rb },
  rpm: { Icon: Box, color: C.rb },
  jar: { Icon: Box, color: C.java },
  war: { Icon: Box, color: C.java },
  appimage: { Icon: Box, color: C.config },

  // ── Fonts ────────────────────────────────────────────────────────
  ttf: { Icon: Type, color: C.text },
  otf: { Icon: Type, color: C.text },
  woff: { Icon: Type, color: C.text },
  woff2: { Icon: Type, color: C.text },
  eot: { Icon: Type, color: C.text },

  // ── Security ─────────────────────────────────────────────────────
  pem: { Icon: Shield, color: C.key },
  crt: { Icon: Shield, color: C.key },
  cer: { Icon: Shield, color: C.key },
  csr: { Icon: Shield, color: C.key },
  key: { Icon: KeyRound, color: C.key },
  pub: { Icon: KeyRound, color: C.key },
  asc: { Icon: Shield, color: C.key },
  lock: { Icon: FileLock2, color: C.lock },

  // ── Binary ───────────────────────────────────────────────────────
  exe: { Icon: Binary, color: C.binary },
  dll: { Icon: Binary, color: C.binary },
  so: { Icon: Binary, color: C.binary },
  dylib: { Icon: Binary, color: C.binary },
  bin: { Icon: Binary, color: C.binary },
  o: { Icon: Binary, color: C.binary },
  wasm: { Icon: Binary, color: C.php },
  class: { Icon: Binary, color: C.java },
  pyc: { Icon: Binary, color: C.py },
  db: { Icon: Database, color: C.sql },
  sqlite: { Icon: Database, color: C.sql },
  sqlite3: { Icon: Database, color: C.sql },

  // ── Diffs ────────────────────────────────────────────────────────
  diff: { Icon: GitBranch, color: C.git },
  patch: { Icon: GitBranch, color: C.git },
};

/**
 * Exact filenames beat extensions. `package.json` should not look like any
 * other JSON file, and `Dockerfile` has no extension at all.
 */
const NAME: Record<string, IconSpec> = {
  'package.json': { Icon: Box, color: C.rb },
  'package-lock.json': { Icon: FileLock2, color: C.lock },
  'yarn.lock': { Icon: FileLock2, color: C.lock },
  'pnpm-lock.yaml': { Icon: FileLock2, color: C.lock },
  'bun.lockb': { Icon: FileLock2, color: C.lock },
  'composer.lock': { Icon: FileLock2, color: C.lock },
  'cargo.lock': { Icon: FileLock2, color: C.lock },
  'cargo.toml': { Icon: Cog, color: C.rs },
  'go.mod': { Icon: Box, color: C.go },
  'go.sum': { Icon: FileLock2, color: C.lock },
  'requirements.txt': { Icon: Box, color: C.py },
  'pipfile': { Icon: Box, color: C.py },
  'gemfile': { Icon: Box, color: C.rb },
  'rakefile': { Icon: Box, color: C.rb },
  'makefile': { Icon: Cog, color: C.config },
  'dockerfile': { Icon: Container, color: C.docker },
  'docker-compose.yml': { Icon: Container, color: C.docker },
  'docker-compose.yaml': { Icon: Container, color: C.docker },
  '.dockerignore': { Icon: Container, color: C.neutral },
  '.gitignore': { Icon: GitBranch, color: C.git },
  '.gitattributes': { Icon: GitBranch, color: C.git },
  '.gitmodules': { Icon: GitBranch, color: C.git },
  'readme': { Icon: FileText, color: C.md },
  'readme.md': { Icon: FileText, color: C.md },
  'license': { Icon: Shield, color: C.key },
  'licence': { Icon: Shield, color: C.key },
  'changelog': { Icon: ScrollText, color: C.md },
  'changelog.md': { Icon: ScrollText, color: C.md },
  'tsconfig.json': { Icon: Cog, color: C.ts },
  'jsconfig.json': { Icon: Cog, color: C.js },
  'vite.config.ts': { Icon: Cog, color: C.vue },
  'vite.config.js': { Icon: Cog, color: C.vue },
  'webpack.config.js': { Icon: Cog, color: C.ts },
  'tailwind.config.js': { Icon: Cog, color: C.react },
  'postcss.config.js': { Icon: Cog, color: C.config },
  'eslint.config.js': { Icon: Cog, color: C.cs },
  '.eslintrc': { Icon: Cog, color: C.cs },
  '.prettierrc': { Icon: Cog, color: C.sass },
  '.editorconfig': { Icon: Cog, color: C.config },
  '.npmrc': { Icon: Cog, color: C.rb },
  '.nvmrc': { Icon: Cog, color: C.sheet },
  '.env': { Icon: FileLock2, color: C.key },
  'nginx.conf': { Icon: Cog, color: C.sheet },
  'ecosystem.config.cjs': { Icon: Cog, color: C.vue },
  'crontab': { Icon: Cog, color: C.config },
};

/** Directories that deserve their own glyph. */
const DIR_NAME: Record<string, IconSpec> = {
  '.git': { Icon: FolderGit2, color: C.git },
  '.ssh': { Icon: FolderLock, color: C.key },
  '.openclaw': { Icon: FolderLock, color: 'text-accent' },
  node_modules: { Icon: Folder, color: C.neutral },
  '.cache': { Icon: Folder, color: C.neutral },
  dist: { Icon: Folder, color: C.neutral },
  build: { Icon: Folder, color: C.neutral },
  '.trash': { Icon: Folder, color: C.neutral },
};

const DEFAULT_FILE: IconSpec = { Icon: FileWarning, color: C.neutral };
const DEFAULT_DIR: IconSpec = { Icon: Folder, color: 'text-accent' };

export function fileIcon(name: string, isDirectory: boolean): IconSpec {
  const lower = name.toLowerCase();

  if (isDirectory) return DIR_NAME[lower] || DEFAULT_DIR;

  if (NAME[lower]) return NAME[lower];

  // `.env.production`, `.eslintrc.json`, `readme.txt` …
  for (const key of Object.keys(NAME)) {
    if (key.startsWith('.') && lower.startsWith(key + '.')) return NAME[key];
  }

  const ext = lower.includes('.') ? lower.split('.').pop()! : '';
  if (ext && EXT[ext]) return EXT[ext];

  // Extensionless files on a server are usually scripts or config.
  if (!ext) return { Icon: FileText, color: C.text };

  return DEFAULT_FILE;
}

/**
 * Short type label for the list's Type column, VS Code style: the extension
 * itself is the most informative thing you can show.
 */
export function typeLabel(name: string, isDirectory: boolean): string {
  if (isDirectory) return 'Folder';
  const lower = name.toLowerCase();
  if (!lower.includes('.') || lower.startsWith('.') && lower.indexOf('.', 1) === -1) {
    return lower.startsWith('.') ? 'dotfile' : 'file';
  }
  return (lower.split('.').pop() || '').slice(0, 8);
}
