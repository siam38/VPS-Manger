import { 
  File, Folder, FileText, FileCode, FileImage, FileVideo, FileAudio,
  FileArchive, FileJson, Database, Settings, Lock, Terminal, FileType,
  FileSpreadsheet, Presentation, Globe, Package, Coffee, Hash, Gem,
  Braces, Code2, FileWarning, Shield, Key, Cpu, HardDrive, Binary
} from 'lucide-react';

const EXT_MAP: Record<string, any> = {
  // Code
  js: FileCode, jsx: FileCode, ts: FileCode, tsx: FileCode, mjs: FileCode, cjs: FileCode,
  py: FileCode, rb: FileCode, go: FileCode, rs: FileCode, java: FileCode, c: FileCode,
  cpp: FileCode, h: FileCode, hpp: FileCode, cs: FileCode, php: FileCode, swift: FileCode,
  kt: FileCode, scala: FileCode, r: FileCode, lua: FileCode, pl: FileCode, sh: Terminal,
  bash: Terminal, zsh: Terminal, fish: Terminal, ps1: Terminal, bat: Terminal, cmd: Terminal,
  // Web
  html: Globe, htm: Globe, css: FileCode, scss: FileCode, sass: FileCode, less: FileCode,
  vue: FileCode, svelte: FileCode,
  // Data
  json: FileJson, yaml: FileJson, yml: FileJson, toml: FileJson, xml: FileCode, csv: FileSpreadsheet,
  tsv: FileSpreadsheet, sql: Database, db: Database, sqlite: Database,
  // Config
  env: Settings, ini: Settings, cfg: Settings, conf: Settings, config: Settings,
  gitignore: Settings, dockerignore: Settings, editorconfig: Settings, eslintrc: Settings,
  prettierrc: Settings, babelrc: Settings,
  // Docs
  md: FileText, mdx: FileText, txt: FileText, log: FileText, rst: FileText, tex: FileText,
  pdf: FileType, doc: FileText, docx: FileText, rtf: FileText,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, ppt: Presentation, pptx: Presentation,
  // Images
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, svg: FileImage,
  webp: FileImage, ico: FileImage, bmp: FileImage, tiff: FileImage, avif: FileImage,
  // Video
  mp4: FileVideo, mkv: FileVideo, avi: FileVideo, mov: FileVideo, webm: FileVideo,
  flv: FileVideo, wmv: FileVideo,
  // Audio
  mp3: FileAudio, wav: FileAudio, ogg: FileAudio, flac: FileAudio, aac: FileAudio,
  m4a: FileAudio, wma: FileAudio,
  // Archives
  zip: FileArchive, tar: FileArchive, gz: FileArchive, bz2: FileArchive, xz: FileArchive,
  rar: FileArchive, '7z': FileArchive, tgz: FileArchive,
  // Package
  deb: Package, rpm: Package, dmg: Package, msi: Package, appimage: Package,
  // Special
  lock: Lock, key: Key, pem: Shield, crt: Shield, cert: Shield,
  dockerfile: Cpu, makefile: Settings, rakefile: Gem, gemfile: Gem,
  // Binary
  exe: Binary, dll: Binary, so: Binary, dylib: Binary, wasm: Binary, bin: Binary,
};

const NAME_MAP: Record<string, any> = {
  dockerfile: Cpu,
  makefile: Settings,
  rakefile: Gem,
  gemfile: Gem,
  'package.json': Package,
  'package-lock.json': Lock,
  'yarn.lock': Lock,
  'pnpm-lock.yaml': Lock,
  '.gitignore': Settings,
  '.env': Lock,
  '.env.local': Lock,
  '.env.production': Lock,
  'docker-compose.yml': Cpu,
  'docker-compose.yaml': Cpu,
  'tsconfig.json': Settings,
  'vite.config.ts': Settings,
  'webpack.config.js': Settings,
};

const EXT_COLOR: Record<string, string> = {
  js: 'text-yellow-400', jsx: 'text-yellow-400', ts: 'text-blue-400', tsx: 'text-blue-400',
  py: 'text-green-400', rb: 'text-red-400', go: 'text-cyan-400', rs: 'text-orange-400',
  java: 'text-red-500', html: 'text-orange-400', css: 'text-blue-500',
  json: 'text-yellow-300', yaml: 'text-pink-400', yml: 'text-pink-400',
  md: 'text-gray-300', txt: 'text-gray-400', log: 'text-gray-500',
  png: 'text-purple-400', jpg: 'text-purple-400', svg: 'text-green-300',
  mp4: 'text-pink-500', mp3: 'text-green-500',
  zip: 'text-amber-500', tar: 'text-amber-500', gz: 'text-amber-500',
  sh: 'text-green-400', bash: 'text-green-400',
  sql: 'text-blue-300', db: 'text-blue-300',
  lock: 'text-red-300', key: 'text-yellow-500',
  env: 'text-yellow-600',
};

export function getFileIcon(name: string, isDirectory: boolean) {
  if (isDirectory) return { Icon: Folder, color: 'text-blue-400' };
  
  const lower = name.toLowerCase();
  
  // Check exact name match first
  if (NAME_MAP[lower]) return { Icon: NAME_MAP[lower], color: EXT_COLOR[lower] || 'text-dark-300' };
  
  // Check extension
  const ext = lower.split('.').pop() || '';
  const Icon = EXT_MAP[ext] || File;
  const color = EXT_COLOR[ext] || 'text-dark-300';
  
  return { Icon, color };
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  });
}
