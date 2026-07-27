/**
 * File classification.
 *
 * The old FileManager had four overlapping extension sets and three functions
 * that disagreed about what "text" meant, so `.conf` opened but `.service`
 * silently failed. One table, one answer.
 */

export type FileKind =
  | 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'archive' | 'document' | 'binary';

const IMAGE = new Set(['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif','apng']);
const AUDIO = new Set(['mp3','wav','ogg','flac','aac','m4a','opus','weba']);
const VIDEO = new Set(['mp4','webm','mov','m4v','ogv']);
const ARCHIVE = new Set(['zip','tar','gz','tgz','bz2','xz','7z','rar','iso','dmg','jar','war']);
const DOCUMENT = new Set(['doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','epub']);
const BINARY = new Set([
  'exe','dll','so','dylib','bin','o','a','class','pyc','pyo','wasm',
  'db','sqlite','sqlite3','woff','woff2','ttf','otf','eot','node','deb','rpm',
]);

const TEXT = new Set([
  // code
  'js','jsx','ts','tsx','mjs','cjs','mts','cts','py','pyw','rb','go','rs','java',
  'c','cc','cpp','h','hpp','cs','php','swift','kt','kts','scala','r','lua','pl',
  'sh','bash','zsh','fish','ps1','bat','cmd','vue','svelte','dart','ex','exs',
  'erl','hs','clj','groovy','m','mm','sql','graphql','gql','prisma','proto',
  // web
  'html','htm','css','scss','sass','less','styl',
  // data / config
  'json','jsonc','json5','yaml','yml','toml','xml','csv','tsv','ini','cfg','conf',
  'config','properties','env','lock','plist',
  // docs
  'md','mdx','markdown','txt','log','rst','tex','adoc','org','nfo',
  // system
  'service','timer','socket','mount','target','rules','list','sources','repo',
  'gitignore','gitattributes','gitmodules','dockerignore','editorconfig',
  'eslintrc','prettierrc','babelrc','npmrc','nvmrc','htaccess','patch','diff',
  'pem','crt','cer','pub','key','csr','asc',
]);

/** Files with no extension that are still text. */
const TEXT_NAMES = new Set([
  'dockerfile','makefile','rakefile','gemfile','procfile','vagrantfile','jenkinsfile',
  'brewfile','caddyfile','readme','license','licence','changelog','authors',
  'contributing','notice','copying','install','todo','version','manifest',
]);

/** Text files that begin with a dot. */
const DOTFILE_PREFIXES = [
  '.env','.bashrc','.zshrc','.profile','.bash_profile','.bash_history','.inputrc',
  '.vimrc','.gitconfig','.gitignore','.gitattributes','.npmrc','.yarnrc','.nvmrc',
  '.editorconfig','.eslintrc','.prettierrc','.babelrc','.dockerignore','.htaccess',
  '.curlrc','.wgetrc','.netrc','.ssh_config','.tmux.conf',
];

export function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  if (!lower.includes('.') || lower.startsWith('.') && lower.indexOf('.', 1) === -1) return '';
  return lower.split('.').pop() || '';
}

export function classifyFile(name: string): FileKind {
  const lower = name.toLowerCase();

  if (TEXT_NAMES.has(lower)) return 'text';
  if (DOTFILE_PREFIXES.some(p => lower === p || lower.startsWith(p + '.'))) return 'text';

  const ext = extensionOf(name);

  if (ext === 'pdf') return 'pdf';
  if (IMAGE.has(ext)) return 'image';
  if (AUDIO.has(ext)) return 'audio';
  if (VIDEO.has(ext)) return 'video';
  if (ARCHIVE.has(ext)) return 'archive';
  if (DOCUMENT.has(ext)) return 'document';
  if (BINARY.has(ext)) return 'binary';
  if (TEXT.has(ext)) return 'text';

  // No extension at all is usually a script or a config on a server box.
  if (!ext) return 'text';

  return 'binary';
}

/** Can this open in the code editor? */
export function isEditable(name: string): boolean {
  return classifyFile(name) === 'text';
}

/** Can this be shown inline in some form? */
export function isPreviewable(name: string): boolean {
  const kind = classifyFile(name);
  return kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'pdf';
}

export const KIND_LABEL: Record<FileKind, string> = {
  text: 'Text',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  pdf: 'PDF',
  archive: 'Archive',
  document: 'Document',
  binary: 'Binary',
};
