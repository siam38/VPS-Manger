import React, { useEffect, useState, useRef, useCallback } from 'react';
import { apiGet, apiPost, apiDelete, downloadFile } from '../lib/api';
import { getFileIcon, formatBytes, formatDate } from '../lib/utils';
import {
  ChevronRight, Home, Upload, FolderPlus, FilePlus, RefreshCw, Download,
  Trash2, Edit2, Copy, Scissors, ClipboardPaste, Eye, EyeOff,
  MoreVertical, X, Check, ArrowLeft, Search, Save, Code2, CheckSquare,
  Maximize2, Minimize2, Zap, Clock, GitBranch, Code, FileText, Image as ImageIcon,
  Music, Video, FileArchive, FileSpreadsheet, Terminal, Play, Pause
} from 'lucide-react';

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  permissions: string;
}

const TEXT_EXTENSIONS = new Set([
  'js','jsx','ts','tsx','mjs','cjs','py','rb','go','rs','java','c','cpp','h','hpp',
  'cs','php','swift','kt','scala','r','lua','pl','sh','bash','zsh','fish','ps1',
  'bat','cmd','html','htm','css','scss','sass','less','vue','svelte','json','yaml',
  'yml','toml','xml','csv','tsv','sql','env','ini','cfg','conf','config','gitignore',
  'dockerignore','editorconfig','eslintrc','prettierrc','babelrc','md','mdx','txt',
  'log','rst','tex','makefile','dockerfile','rakefile','gemfile','graphql','prisma',
  'nginx','service','timer','socket','rules','crt','pem','pub','key',
]);

const IMAGE_EXTENSIONS = new Set([
  'jpg','jpeg','png','gif','webp','svg','bmp','ico','tiff','tif','avif',
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3','wav','ogg','flac','aac','m4a','wma','opus','aiff',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4','webm','mov','avi','mkv','flv','wmv','m4v','3gp',
]);

const ARCHIVE_EXTENSIONS = new Set([
  'zip','tar','gz','tgz','bz2','xz','7z','rar','iso','dmg',
]);

const DOCUMENT_EXTENSIONS = new Set([
  'pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','epub',
]);

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  // Check exact names
  const knownNames = ['dockerfile', 'makefile', 'rakefile', 'gemfile', '.gitignore', '.env', '.env.local', '.env.production', 'readme', 'license', 'changelog'];
  if (knownNames.some(n => lower === n || lower.endsWith(`/${n}`))) return true;
  const ext = lower.split('.').pop() || '';
  return TEXT_EXTENSIONS.has(ext);
}

const EXT_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', swift: 'swift',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
  md: 'markdown', mdx: 'markdown', txt: 'plaintext', log: 'plaintext',
  sh: 'shell', bash: 'shell', zsh: 'shell', dockerfile: 'dockerfile',
  sql: 'sql', graphql: 'graphql', lua: 'lua', r: 'r',
  env: 'plaintext', ini: 'ini', conf: 'plaintext',
};

function getLang(name: string): string {
  const lower = name.toLowerCase();
  if (EXT_LANG[lower]) return EXT_LANG[lower];
  const ext = lower.split('.').pop() || '';
  return EXT_LANG[ext] || 'plaintext';
}

function getFileType(name: string): 'image' | 'audio' | 'video' | 'archive' | 'document' | 'text' | 'other' {
  const ext = name.toLowerCase().split('.').pop() || '';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'other';
}

function getFileTypeInfo(type: string) {
  switch (type) {
    case 'image': return { icon: ImageIcon, color: 'text-pink-400', label: 'Image' };
    case 'audio': return { icon: Music, color: 'text-purple-400', label: 'Audio' };
    case 'video': return { icon: Video, color: 'text-red-400', label: 'Video' };
    case 'archive': return { icon: FileArchive, color: 'text-yellow-400', label: 'Archive' };
    case 'document': return { icon: FileSpreadsheet, color: 'text-blue-400', label: 'Document' };
    case 'text': return { icon: FileText, color: 'text-green-400', label: 'Text' };
    default: return { icon: FileText, color: 'text-muted', label: 'File' };
  }
}

const ALLOWED_BASES = ['/root', '/var/www', '/home', '/opt', '/tmp'];

function getAllowedBase(p: string): string {
  return ALLOWED_BASES.find(b => p.startsWith(b)) || '/root';
}

export default function FileManager() {
  const [currentPath, setCurrentPath] = useState('/root');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem('vps_show_hidden') === 'true');
  useEffect(() => { localStorage.setItem('vps_show_hidden', String(showHidden)); }, [showHidden]);
  const [openclawBackPath, setOpenclawBackPath] = useState('/home');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<{ items: string[]; mode: 'copy' | 'cut' } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFileMode, setNewFileMode] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState('text');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: FileItem } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  
  // Editor state
  const [editingFile, setEditingFile] = useState<{ path: string; name: string; content: string; language: string } | null>(null);
  const [editorModified, setEditorModified] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorSaved, setEditorSaved] = useState(false);
  const [monacoReady, setMonacoReady] = useState(false);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [editorLineNumbers, setEditorLineNumbers] = useState(true);
  const [editorWordWrap, setEditorWordWrap] = useState(false);
  const [editorMinimap, setEditorMinimap] = useState(true);
  const [editorFontSize, setEditorFontSize] = useState(14);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<any>(null);

  // Load Monaco lazily
  useEffect(() => {
    if ((window as any).require?.config) {
      setMonacoReady(true);
      return;
    }
    const existing = document.querySelector('script[src*="monaco-editor"]');
    if (existing) {
      const check = setInterval(() => {
        if ((window as any).require) {
          clearInterval(check);
          const r = (window as any).require;
          r.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' } });
          r(['vs/editor/editor.main'], () => setMonacoReady(true));
        }
      }, 100);
      return () => clearInterval(check);
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs/loader.js';
    script.onload = () => {
      const r = (window as any).require;
      r.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' } });
      r(['vs/editor/editor.main'], (m: any) => {
        monacoRef.current = m;
        if (!m.editor.getModel(m.Uri.parse('foxclaw-dark-check'))) {
          m.editor.defineTheme('foxclaw-dark', {
            base: 'vs-dark', inherit: true,
            rules: [
              { token: 'comment', foreground: '475569', fontStyle: 'italic' },
              { token: 'keyword', foreground: 'c084fc' },
              { token: 'string', foreground: '4ade80' },
              { token: 'number', foreground: 'fbbf24' },
              { token: 'type', foreground: '60a5fa' },
            ],
            colors: {
              'editor.background': '#060e0d',
              'editor.foreground': '#d6e7e5',
              'editor.lineHighlightBackground': '#1a2b2a40',
              'editor.selectionBackground': '#14b8a633',
              'editorCursor.foreground': '#14b8a6',
              'editorLineNumber.foreground': '#2a3f3d',
              'editorLineNumber.activeForeground': '#82a8a4',
            }
          });
        }
        setMonacoReady(true);
      });
    };
    document.head.appendChild(script);
  }, []);

  // Create editor when editing file
  useEffect(() => {
    if (!editingFile || !monacoReady || !editorContainerRef.current) return;
    
    const monaco = monacoRef.current || (window as any).monaco;
    if (!monaco) return;
    monacoRef.current = monaco;

    // Cleanup previous
    if (editorRef.current) {
      editorRef.current.dispose();
      editorRef.current = null;
    }

    const uri = monaco.Uri.file(editingFile.path);
    let model = monaco.editor.getModel(uri);
    if (model) model.dispose();
    model = monaco.editor.createModel(editingFile.content, editingFile.language, uri);

    const isMobile = window.innerWidth < 768;
    const editor = monaco.editor.create(editorContainerRef.current, {
      model,
      theme: 'foxclaw-dark',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: isMobile ? 12 : 13,
      lineHeight: isMobile ? 18 : 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 8 },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      wordWrap: isMobile ? 'on' : 'off',
      lineNumbers: isMobile ? 'off' : 'on',
      folding: !isMobile,
      glyphMargin: false,
      lineDecorationsWidth: isMobile ? 4 : 10,
      lineNumbersMinChars: isMobile ? 2 : 3,
    });

    editor.onDidChangeModelContent(() => {
      setEditorModified(true);
      if (editingFile) {
        editingFile.content = editor.getValue();
      }
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveEditorFile();
    });

    editorRef.current = editor;

    return () => {
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
      if (model) model.dispose();
    };
  }, [editingFile, monacoReady]);

  const openFileInEditor = async (item: FileItem) => {
    try {
      const fileType = getFileType(item.name);
      
      // For non-text files, show appropriate message
      if (fileType === 'image') {
        alert(`Image file: ${item.name}\n\nPreview functionality coming soon.\n\nYou can download this file to view it.`);
        return;
      }
      
      if (fileType === 'video' || fileType === 'audio') {
        alert(`Media file: ${item.name}\n\nMedia player coming soon.\n\nYou can download this file to play it.`);
        return;
      }
      
      if (fileType === 'document') {
        alert(`Document: ${item.name}\n\nDocument viewer coming soon.\n\nYou can download this file to view it.`);
        return;
      }
      
      if (fileType === 'archive') {
        alert(`Archive: ${item.name}\n\nArchive extraction coming soon.\n\nYou can download this file to extract it.`);
        return;
      }
      
      if (!isTextFile(item.name)) {
        alert(`This file type cannot be edited in the browser.\n\nFile: ${item.name}`);
        return;
      }
      
      const data = await apiGet<{ content: string }>(`/api/files/content?path=${encodeURIComponent(item.path)}`);
      setEditingFile({ path: item.path, name: item.name, content: data.content, language: getLang(item.name) });
      setEditorModified(false);
      setEditorSaved(false);
    } catch (e: any) {
      alert(e.message || 'Cannot open this file');
    }
  };

  const saveEditorFile = async () => {
    if (!editingFile || !editorRef.current) return;
    setEditorSaving(true);
    try {
      const content = editorRef.current.getValue();
      await apiPost('/api/files/save', { path: editingFile.path, content });
      setEditingFile({ ...editingFile, content });
      setEditorModified(false);
      setEditorSaved(true);
      setTimeout(() => setEditorSaved(false), 2000);
    } catch (e: any) {
      alert(e.message);
    }
    setEditorSaving(false);
  };

  const closeEditor = () => {
    if (editorModified && !confirm('You have unsaved changes. Are you sure you want to close?')) {
      return;
    }
    setEditingFile(null);
    setEditorModified(false);
    setEditorFullscreen(false);
  };

  const updateEditorOption = (option: string, value: any) => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ [option]: value });
    }
  };

  const toggleFullscreen = () => {
    setEditorFullscreen(!editorFullscreen);
  };

  const increaseFontSize = () => {
    const newSize = editorFontSize + 2;
    setEditorFontSize(newSize);
    updateEditorOption('fontSize', newSize);
  };

  const decreaseFontSize = () => {
    const newSize = Math.max(10, editorFontSize - 2);
    setEditorFontSize(newSize);
    updateEditorOption('fontSize', newSize);
  };

  const load = async (p?: string) => {
    const target = p ?? currentPath;
    setLoading(true);
    try {
      const data = await apiGet(`/api/files/list?path=${encodeURIComponent(target)}&hidden=${showHidden}`);
      setItems(data.items);
      setCurrentPath(data.path);
      setSelected(new Set());
    } catch (e: any) {
      alert(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [showHidden]);

  const navigate = (p: string) => { load(p); };

  const pathParts = currentPath.split('/').filter(Boolean);

  const filteredItems = search
    ? items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const fd = new FormData();
    fd.append('path', currentPath);
    for (let i = 0; i < files.length; i++) fd.append('files', files[i]);
    try {
      const token = localStorage.getItem('vps_token') || '';
      await fetch('/api/files/upload', {
        method: 'POST', body: fd,
        headers: { Authorization: `Bearer ${token}` },
      });
      load();
    } catch (e: any) { alert(e.message); }
    e.target.value = '';
  };

  const handleDelete = async (paths: string[]) => {
    if (!confirm(`Delete ${paths.length} item(s)?`)) return;
    for (const p of paths) {
      try { await apiDelete('/api/files/delete', { path: p }); } catch {}
    }
    load();
  };

  const handleRename = async (oldPath: string) => {
    if (!renameValue.trim()) { setRenaming(null); return; }
    const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
    try {
      await apiPost('/api/files/rename', { oldPath, newPath: `${dir}/${renameValue}` });
      load();
    } catch (e: any) { alert(e.message); }
    setRenaming(null);
  };

  const handleNewFolder = async () => {
    if (!newFolderName.trim()) { setNewFolderMode(false); return; }
    try {
      await apiPost('/api/files/mkdir', { path: currentPath, name: newFolderName });
      load();
    } catch (e: any) { alert(e.message); }
    setNewFolderMode(false);
    setNewFolderName('');
  };

  const handleNewFile = async () => {
    if (!newFileName.trim()) { setNewFileMode(false); return; }
    try {
      // Add extension based on type if not present
      let fileName = newFileName;
      if (newFileType === 'text' && !fileName.includes('.')) {
        fileName += '.txt';
      } else if (newFileType === 'html' && !fileName.includes('.')) {
        fileName += '.html';
      } else if (newFileType === 'css' && !fileName.includes('.')) {
        fileName += '.css';
      } else if (newFileType === 'js' && !fileName.includes('.')) {
        fileName += '.js';
      } else if (newFileType === 'json' && !fileName.includes('.')) {
        fileName += '.json';
      } else if (newFileType === 'md' && !fileName.includes('.')) {
        fileName += '.md';
      }
      
      const filePath = `${currentPath}/${fileName}`;
      await apiPost('/api/files/save', { path: filePath, content: '' });
      load();
    } catch (e: any) { alert(e.message); }
    setNewFileMode(false);
    setNewFileName('');
    setNewFileType('text');
  };

  const handlePaste = async () => {
    if (!clipboard) return;
    for (const src of clipboard.items) {
      const name = src.split('/').pop();
      const dest = `${currentPath}/${name}`;
      try {
        if (clipboard.mode === 'copy') {
          await apiPost('/api/files/copy', { sourcePath: src, destPath: dest });
        } else {
          await apiPost('/api/files/rename', { oldPath: src, newPath: dest });
        }
      } catch {}
    }
    setClipboard(null);
    load();
  };

  const handleContextMenu = (e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  // Mobile long-press handlers
  const handleTouchStart = (item: FileItem) => {
    longPressTimer.current = setTimeout(() => {
      if (!item.isDirectory && isTextFile(item.name)) {
        openFileInEditor(item);
      }
    }, 600);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div className="h-full flex flex-col animate-fade-in" onClick={() => setContextMenu(null)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-dark-700 bg-dark-800/30 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:gap-1 max-sm:p-2">
        <button onClick={() => navigate(currentPath.substring(0, currentPath.lastIndexOf('/')) || getAllowedBase(currentPath))}
          className="p-1.5 rounded-lg hover:bg-dark-700 text-dark-300 hover:text-white transition">
          <ArrowLeft className="w-4 h-4" />
        </button>
        
        {/* Breadcrumbs */}
        <div className="flex items-center gap-0.5 text-xs overflow-x-auto flex-1 min-w-0">
          <button onClick={() => navigate(getAllowedBase(currentPath))} className="text-muted hover:text-white transition p-1 rounded">
            <Home className="w-3.5 h-3.5" />
          </button>
          {pathParts.map((part, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="w-3 h-3 text-dark-600 flex-shrink-0" />
              <button
                onClick={() => navigate('/' + pathParts.slice(0, i + 1).join('/'))}
                className="text-dark-300 hover:text-white transition truncate max-w-[120px] px-1 rounded"
              >
                {part}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <select
            value={getAllowedBase(currentPath)}
            onChange={e => navigate(e.target.value)}
            className="bg-dark-900 border border-dark-600 rounded-lg text-xs max-sm:text-[10px] text-white px-2 max-sm:px-1 py-1.5 max-sm:py-1 focus:outline-none focus:border-accent"
            title="Jump to base directory"
          >
            {ALLOWED_BASES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <button
            onClick={() => {
              if (currentPath.startsWith('/home/ubuntu/.openclaw')) {
                navigate(openclawBackPath);
              } else {
                setOpenclawBackPath(currentPath);
                setShowHidden(true);
                navigate('/home/ubuntu/.openclaw');
              }
            }}
            className={`hidden md:inline-flex px-2 py-1.5 rounded-lg transition text-xs font-medium items-center gap-1.5 ${currentPath.startsWith('/home/ubuntu/.openclaw') ? 'bg-accent text-dark-900 hover:bg-accent/90' : 'bg-accent/10 text-accent hover:bg-accent/20'}`}
            title={currentPath.startsWith('/home/ubuntu/.openclaw') ? 'Back to previous folder' : 'Open OpenClaw Workspace'}
          >
            OpenClaw
          </button>
          <button
            onClick={() => {
              if (currentPath.startsWith('/home/ubuntu/.openclaw')) {
                navigate(openclawBackPath);
              } else {
                setOpenclawBackPath(currentPath);
                setShowHidden(true);
                navigate('/home/ubuntu/.openclaw');
              }
            }}
            className={`md:hidden p-1.5 rounded-lg transition ${currentPath.startsWith('/home/ubuntu/.openclaw') ? 'bg-accent text-dark-900 hover:bg-accent/90' : 'bg-accent/10 text-accent hover:bg-accent/20'}`}
            title={currentPath.startsWith('/home/ubuntu/.openclaw') ? 'Back' : 'OpenClaw'}
          >
            <Zap className="w-4 h-4" />
          </button>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-subtle" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-24 sm:w-32 md:w-40 pl-7 pr-2 py-1.5 bg-dark-900 border border-dark-600 rounded-lg text-xs text-white focus:outline-none focus:border-accent"
            />
          </div>
          <button onClick={() => setShowHidden(!showHidden)}
            className={`p-1.5 rounded-lg transition ${showHidden ? 'bg-accent/10 text-accent' : 'text-muted hover:text-white hover:bg-dark-700'}`}
            title="Toggle hidden files">
            {showHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          <button onClick={() => { setNewFolderMode(true); setNewFolderName(''); }}
            className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-dark-700 transition" title="New folder">
            <FolderPlus className="w-4 h-4" />
          </button>
          <button onClick={() => { setNewFileMode(true); setNewFileName(''); setNewFileType('text'); }}
            className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-dark-700 transition" title="New file">
            <FilePlus className="w-4 h-4" />
          </button>
          <button onClick={() => uploadRef.current?.click()}
            className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-dark-700 transition" title="Upload">
            <Upload className="w-4 h-4" />
          </button>
          {/* Select All / Deselect All */}
          <button onClick={() => {
            if (selected.size > 0) {
              setSelected(new Set());
            } else {
              setSelected(new Set(filteredItems.map(i => i.path)));
            }
          }}
            className={`p-1.5 rounded-lg transition ${selected.size > 0 ? 'bg-accent/10 text-accent' : 'text-muted hover:text-white hover:bg-dark-700'}`}
            title={selected.size > 0 ? 'Deselect All' : 'Select All'}>
            <CheckSquare className="w-4 h-4" />
          </button>
          {clipboard && (
            <button onClick={handlePaste}
              className="p-1.5 rounded-lg text-accent hover:bg-accent/10 transition" title="Paste">
              <ClipboardPaste className="w-4 h-4" />
            </button>
          )}
          {selected.size > 0 && (
            <button onClick={() => handleDelete(Array.from(selected))}
              className="p-1.5 rounded-lg text-red-400 hover:bg-red-400/10 transition" title="Delete selected">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => load()} className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-dark-700 transition">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <input ref={uploadRef} type="file" multiple className="hidden" onChange={handleUpload} />
      </div>

      {/* File List */}
      <div className="flex-1 overflow-auto">
        {/* New folder input */}
        {newFolderMode && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-dark-700 bg-dark-800/50">
            <FolderPlus className="w-4 h-4 text-blue-400" />
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleNewFolder(); if (e.key === 'Escape') setNewFolderMode(false); }}
              className="flex-1 bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-accent"
              placeholder="Folder name..."
            />
            <button onClick={handleNewFolder} className="p-1 text-green-400"><Check className="w-4 h-4" /></button>
            <button onClick={() => setNewFolderMode(false)} className="p-1 text-muted"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* New file input */}
        {newFileMode && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 px-4 py-2 border-b border-dark-700 bg-dark-800/50">
            <div className="flex items-center gap-2 sm:hidden">
              <FilePlus className="w-4 h-4 text-green-400" />
              <span className="text-xs text-muted">New File</span>
            </div>
            <input
              autoFocus
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleNewFile(); if (e.key === 'Escape') setNewFileMode(false); }}
              className="flex-1 bg-dark-900 border border-dark-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-accent min-w-0"
              placeholder="Enter filename..."
            />
            <div className="flex items-center gap-2">
              <select
                value={newFileType}
                onChange={e => setNewFileType(e.target.value)}
                className="bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent min-w-[120px] font-medium"
              >
                <option value="text">📄 Plain Text</option>
                <option value="html">🌐 HTML</option>
                <option value="css">🎨 CSS</option>
                <option value="js">⚡ JavaScript</option>
                <option value="json">📋 JSON</option>
                <option value="md">📝 Markdown</option>
              </select>
              <button onClick={handleNewFile} className="p-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition" title="Create file">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => setNewFileMode(false)} className="p-2 bg-dark-700 text-muted rounded-lg hover:bg-dark-600 hover:text-white transition" title="Cancel">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <table className="w-full">
          <thead className="sticky top-0 bg-dark-800/90 backdrop-blur text-xs text-muted border-b border-dark-700">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th className="text-left px-2 py-2 font-medium">Name</th>
              <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Size</th>
              <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Modified</th>
              <th className="w-20 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => {
              const { Icon, color } = getFileIcon(item.name, item.isDirectory);
              const isSelected = selected.has(item.path);
              const canEdit = !item.isDirectory && isTextFile(item.name);
              return (
                <tr
                  key={item.path}
                  className={`group border-b border-dark-700/50 hover:bg-dark-800/50 cursor-pointer transition
                    ${isSelected ? 'bg-accent/5' : ''}`}
                  onClick={() => {
                    if (item.isDirectory) navigate(item.path);
                  }}
                  onDoubleClick={() => {
                    if (!item.isDirectory && canEdit) openFileInEditor(item);
                  }}
                  onTouchStart={() => handleTouchStart(item)}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchEnd}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                >
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        const next = new Set(selected);
                        if (isSelected) next.delete(item.path); else next.add(item.path);
                        setSelected(next);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded border-dark-500 accent-accent"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className={`w-4 h-4 flex-shrink-0 ${color}`} />
                      {renaming === item.path ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRename(item.path); if (e.key === 'Escape') setRenaming(null); }}
                          onBlur={() => handleRename(item.path)}
                          onClick={e => e.stopPropagation()}
                          className="flex-1 bg-dark-900 border border-accent rounded px-1.5 py-0.5 text-sm text-white focus:outline-none"
                        />
                      ) : (
                        <span className="text-sm text-dark-100 truncate">{item.name}</span>
                      )}
                    </div>
                  </td>
                  <td className="text-right px-3 py-1.5 text-xs text-muted hidden sm:table-cell">
                    {item.isDirectory ? '\u2014' : formatBytes(item.size)}
                  </td>
                  <td className="text-right px-3 py-1.5 text-xs text-muted hidden md:table-cell">
                    {formatDate(item.modified)}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-0.5">
                      {/* Edit button - visible on mobile, visible on hover on desktop */}
                      {canEdit && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openFileInEditor(item); }}
                          className="p-1 rounded text-subtle hover:text-accent transition md:opacity-0 md:group-hover:opacity-100"
                          title="Edit"
                        >
                          <Code2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleContextMenu(e as any, item); }}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 text-muted hover:text-white transition"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredItems.length === 0 && !loading && (
          <div className="text-center text-subtle py-12 text-sm">
            {search ? 'No matching files' : 'Empty directory'}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl py-1 min-w-[160px] animate-fade-in"
          style={{ top: Math.min(contextMenu.y, window.innerHeight - 300), left: Math.min(contextMenu.x, window.innerWidth - 180) }}
          onClick={e => e.stopPropagation()}
        >
          {!contextMenu.item.isDirectory && isTextFile(contextMenu.item.name) && (
            <CtxBtn icon={Code2} label="Edit" onClick={() => { openFileInEditor(contextMenu.item); setContextMenu(null); }} />
          )}
          {!contextMenu.item.isDirectory && (
            <CtxBtn icon={Download} label="Download" onClick={() => { const p = contextMenu.item.path; setContextMenu(null); downloadFile(p).catch((e: any) => alert(e.message || 'Download failed')); }} />
          )}
          <CtxBtn icon={Edit2} label="Rename" onClick={() => {
            setRenaming(contextMenu.item.path);
            setRenameValue(contextMenu.item.name);
            setContextMenu(null);
          }} />
          <CtxBtn icon={Copy} label="Copy" onClick={() => {
            setClipboard({ items: [contextMenu.item.path], mode: 'copy' });
            setContextMenu(null);
          }} />
          <CtxBtn icon={Scissors} label="Cut" onClick={() => {
            setClipboard({ items: [contextMenu.item.path], mode: 'cut' });
            setContextMenu(null);
          }} />
          <div className="border-t border-dark-700 my-1" />
          <CtxBtn icon={Trash2} label="Delete" danger onClick={() => {
            handleDelete([contextMenu.item.path]);
            setContextMenu(null);
          }} />
        </div>
      )}

      {/* Inline Editor Modal */}
      {editingFile && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-dark-900/95 backdrop-blur-sm animate-fade-in">
          {/* Editor Header */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 px-3 md:px-4 py-2 border-b border-dark-700 bg-dark-800/80 flex-shrink-0">
            <div className="flex items-center gap-2 flex-1">
              <Code2 className="w-4 h-4 text-accent flex-shrink-0" />
              <span className="text-sm text-white font-medium truncate flex-1">{editingFile.name}</span>
              <span className="text-[10px] text-subtle uppercase hidden sm:inline px-2 py-0.5 bg-dark-900 rounded">{editingFile.language}</span>
              {editorSaved && (
                <span className="text-[10px] text-green-400 flex items-center gap-1 animate-fade-in px-2 py-0.5 bg-green-400/10 rounded">
                  <Check className="w-3 h-3" /> Saved
                </span>
              )}
              {editorModified && (
                <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0 animate-pulse" title="Unsaved changes" />
              )}
            </div>
            <div className="flex items-center gap-1 overflow-x-auto">
              <button onClick={increaseFontSize} className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-dark-700 transition" title="Increase font size">
                <span className="text-xs font-bold">A+</span>
              </button>
              <button onClick={decreaseFontSize} className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-dark-700 transition" title="Decrease font size">
                <span className="text-xs font-bold">A-</span>
              </button>
              <div className="w-px h-6 bg-dark-700 mx-1" />
              <button onClick={() => { setEditorLineNumbers(!editorLineNumbers); updateEditorOption('lineNumbers', editorLineNumbers ? 'off' : 'on'); }}
                className={`p-1.5 rounded-lg transition ${editorLineNumbers ? 'text-accent bg-accent/10' : 'text-muted hover:text-white hover:bg-dark-700'}`} title="Toggle line numbers">
                <span className="text-xs font-mono">123</span>
              </button>
              <button onClick={() => { setEditorWordWrap(!editorWordWrap); updateEditorOption('wordWrap', editorWordWrap ? 'off' : 'on'); }}
                className={`p-1.5 rounded-lg transition ${editorWordWrap ? 'text-accent bg-accent/10' : 'text-muted hover:text-white hover:bg-dark-700'}`} title="Toggle word wrap">
                <span className="text-xs"><span className="block w-3 h-0.5 bg-current mb-0.5" /><span className="block w-2 h-0.5 bg-current" /></span>
              </button>
              <button onClick={() => { setEditorMinimap(!editorMinimap); updateEditorOption('minimap', { enabled: editorMinimap }); }}
                className={`p-1.5 rounded-lg transition ${editorMinimap ? 'text-accent bg-accent/10' : 'text-muted hover:text-white hover:bg-dark-700'}`} title="Toggle minimap">
                <div className="w-3 h-3 border border-current rounded-sm" />
              </button>
              <div className="w-px h-6 bg-dark-700 mx-1" />
              <button onClick={toggleFullscreen} className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-dark-700 transition" title="Toggle fullscreen">
                {editorFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <div className="w-px h-6 bg-dark-700 mx-1" />
              <button onClick={() => { if (editorRef.current) { const monaco = monacoRef.current || (window as any).monaco; if (monaco) { const model = editorRef.current.getModel(); if (model) { const range = model.getFullModelRange(); editorRef.current.setSelection(range); editorRef.current.focus(); } } } }}
                className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-dark-700 transition" title="Select All">
                <CheckSquare className="w-4 h-4" />
              </button>
              <button onClick={saveEditorFile} disabled={!editorModified || editorSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs font-medium hover:bg-accent/20 transition disabled:opacity-30 border border-accent/20">
                <Save className="w-4 h-4" />
                <span className="hidden sm:inline">{editorSaving ? 'Saving...' : 'Save'}</span>
              </button>
              <button onClick={closeEditor} className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-400/10 transition" title="Close (Esc)">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          {/* Monaco Editor */}
          <div ref={editorContainerRef} className="flex-1" />
          
          {/* Editor Status Bar */}
          <div className="flex items-center justify-between px-4 py-1.5 border-t border-dark-700 bg-dark-800/50 text-[11px] text-muted flex-shrink-0">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /><span>{editingFile.language}</span></span>
              <span className="text-dark-600">|</span>
              <span className="flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5" /><span>UTF-8</span></span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-subtle">Ln {editorRef.current?.getPosition()?.lineNumber || 1}, Col {editorRef.current?.getPosition()?.column || 1}</span>
              <span className="text-subtle">{editingFile.content.split('\n').length} lines</span>
              <span className="text-subtle">Ctrl+S to save</span>
            </div>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="px-4 py-1.5 border-t border-dark-700 bg-dark-800/30 text-xs text-muted flex justify-between items-center">
        <span>{filteredItems.length} items{selected.size > 0 ? ` \u00b7 ${selected.size} selected` : ''}</span>
        <input
          value={currentPath}
          onChange={e => setCurrentPath(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') navigate(currentPath); }}
          className="bg-transparent text-right text-muted hover:text-white focus:text-white focus:outline-none focus:border-b focus:border-accent px-1 min-w-0 flex-1 ml-4"
          title="Press Enter to navigate"
        />
      </div>
    </div>
  );
}

function CtxBtn({ icon: Icon, label, onClick, danger }: { icon: any; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition
        ${danger ? 'text-red-400 hover:bg-red-400/10' : 'text-dark-200 hover:bg-dark-700'}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
