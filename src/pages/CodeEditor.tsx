import React, { useEffect, useState, useRef, useCallback } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { getFileIcon, formatBytes } from '../lib/utils';
import {
  ChevronRight, ChevronDown, Save, X, FolderOpen, RefreshCw,
  File as FileIcon, Home, Plus, Check, ToggleLeft, ToggleRight,
  PanelLeftClose, PanelLeft, Menu, CheckSquare
} from 'lucide-react';

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

interface Tab {
  path: string;
  name: string;
  content: string;
  modified: boolean;
  language: string;
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

export default function CodeEditor() {
  const [treePath, setTreePath] = useState('/root');
  const [treeItems, setTreeItems] = useState<FileItem[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['/root']));
  const [dirContents, setDirContents] = useState<Record<string, FileItem[]>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [monacoReady, setMonacoReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768);
  const [autoSave, setAutoSave] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoSaveTimerRef = useRef<any>(null);
  const autoSaveRef = useRef(autoSave);
  const activeTabRef = useRef(activeTab);
  const tabsRef = useRef(tabs);

  // Keep refs in sync
  useEffect(() => { autoSaveRef.current = autoSave; }, [autoSave]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  // Responsive
  useEffect(() => {
    const handler = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile && sidebarOpen) setSidebarOpen(false);
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Load Monaco
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs/loader.js';
    script.onload = () => {
      const r = (window as any).require;
      r.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' } });
      r(['vs/editor/editor.main'], (m: any) => {
        monacoRef.current = m;
        m.editor.defineTheme('foxclaw-dark', {
          base: 'vs-dark',
          inherit: true,
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
            'editor.inactiveSelectionBackground': '#14b8a618',
          }
        });
        setMonacoReady(true);
      });
    };
    document.head.appendChild(script);
  }, []);

  // Load tree root
  useEffect(() => { loadDir('/root'); }, []);

  const loadDir = async (dirPath: string) => {
    try {
      const data = await apiGet(`/api/files/list?path=${encodeURIComponent(dirPath)}&hidden=false`);
      setDirContents(prev => ({ ...prev, [dirPath]: data.items }));
      if (dirPath === '/root') setTreeItems(data.items);
    } catch {}
  };

  const toggleDir = (dirPath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) { next.delete(dirPath); }
      else { next.add(dirPath); loadDir(dirPath); }
      return next;
    });
  };

  const openFile = async (item: FileItem) => {
    // Close sidebar on mobile after opening file
    if (isMobile) setSidebarOpen(false);

    // Check if already open
    const existing = tabs.find(t => t.path === item.path);
    if (existing) { setActiveTab(item.path); return; }

    try {
      const data = await apiGet(`/api/files/content?path=${encodeURIComponent(item.path)}`);
      const newTab: Tab = { path: item.path, name: item.name, content: data.content, modified: false, language: getLang(item.name) };
      setTabs(prev => [...prev, newTab]);
      setActiveTab(item.path);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const saveFile = useCallback(async (filePath: string | null) => {
    if (!filePath) return;
    const tab = tabsRef.current.find(t => t.path === filePath);
    if (!tab) return;
    try {
      await apiPost('/api/files/save', { path: filePath, content: tab.content });
      setTabs(prev => prev.map(t => t.path === filePath ? { ...t, modified: false } : t));
      setSaveToast(tab.name);
      setTimeout(() => setSaveToast(null), 2000);
    } catch (e: any) { alert(e.message); }
  }, []);

  // Create/update Monaco editor when active tab changes
  useEffect(() => {
    if (!monacoReady || !activeTab || !containerRef.current) return;
    const tab = tabs.find(t => t.path === activeTab);
    if (!tab) return;

    const monaco = monacoRef.current;
    
    if (editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        const currentUri = model.uri.toString();
        const newUri = monaco.Uri.file(tab.path).toString();
        if (currentUri === newUri) return;
      }
    }

    // Dispose old editor
    if (editorRef.current) editorRef.current.dispose();

    const uri = monaco.Uri.file(tab.path);
    let model = monaco.editor.getModel(uri);
    if (!model) {
      model = monaco.editor.createModel(tab.content, tab.language, uri);
    }

    const editor = monaco.editor.create(containerRef.current, {
      model,
      theme: 'foxclaw-dark',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: isMobile ? 12 : 13,
      lineHeight: isMobile ? 18 : 20,
      minimap: { enabled: !isMobile },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 8 },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'line',
      bracketPairColorization: { enabled: true },
      wordWrap: isMobile ? 'on' : 'off',
      lineNumbers: isMobile ? 'off' : 'on',
      folding: !isMobile,
      glyphMargin: false,
      lineDecorationsWidth: isMobile ? 4 : 10,
      lineNumbersMinChars: isMobile ? 2 : 3,
    });

    editor.onDidChangeModelContent(() => {
      const content = editor.getValue();
      setTabs(prev => prev.map(t => t.path === activeTab ? { ...t, content, modified: true } : t));
      
      // Auto-save logic
      if (autoSaveRef.current) {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(() => {
          saveFile(activeTabRef.current);
        }, 2000);
      }
    });

    // Ctrl+S to save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveFile(activeTabRef.current);
    });

    editorRef.current = editor;
  }, [monacoReady, activeTab, isMobile, saveFile]);

  const closeTab = (path: string) => {
    const tab = tabs.find(t => t.path === path);
    if (tab?.modified && !confirm('Unsaved changes. Close anyway?')) return;
    
    // Dispose monaco model
    if (monacoRef.current) {
      const uri = monacoRef.current.Uri.file(path);
      const model = monacoRef.current.editor.getModel(uri);
      if (model) model.dispose();
    }

    setTabs(prev => {
      const next = prev.filter(t => t.path !== path);
      if (activeTab === path) {
        setActiveTab(next.length > 0 ? next[next.length - 1].path : null);
      }
      return next;
    });
  };

  const renderTree = (items: FileItem[], depth = 0) => {
    return items.map(item => {
      const { Icon, color } = getFileIcon(item.name, item.isDirectory);
      const isExpanded = expandedDirs.has(item.path);
      const children = dirContents[item.path] || [];

      return (
        <div key={item.path}>
          <div
            className={`flex items-center gap-1.5 px-2 py-1 md:py-0.5 cursor-pointer hover:bg-dark-700/50 transition text-xs
              ${activeTab === item.path ? 'bg-accent/10 text-accent' : 'text-dark-300'}`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => item.isDirectory ? toggleDir(item.path) : openFile(item)}
          >
            {item.isDirectory ? (
              isExpanded ? <ChevronDown className="w-3 h-3 text-subtle flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-subtle flex-shrink-0" />
            ) : <span className="w-3" />}
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${color}`} />
            <span className="truncate">{item.name}</span>
          </div>
          {item.isDirectory && isExpanded && children.length > 0 && renderTree(children, depth + 1)}
        </div>
      );
    });
  };

  const activeTabData = tabs.find(t => t.path === activeTab);

  return (
    <div className="h-full flex animate-fade-in relative">
      {/* Mobile sidebar overlay */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* File Tree Sidebar */}
      <div className={`
        ${isMobile 
          ? `fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
          : `${sidebarOpen ? 'w-56' : 'w-0'} transition-all duration-200`
        }
        bg-dark-800 border-r border-dark-700 flex flex-col overflow-hidden
      `}>
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-dark-700">
          <span className="text-xs font-medium text-dark-300 uppercase tracking-wide">Explorer</span>
          <div className="flex items-center gap-1">
            <button onClick={() => loadDir('/root')} className="text-subtle hover:text-white p-1">
              <RefreshCw className="w-3 h-3" />
            </button>
            {isMobile && (
              <button onClick={() => setSidebarOpen(false)} className="text-subtle hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {renderTree(treeItems)}
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab Bar */}
        <div className="flex items-center bg-dark-800/50 border-b border-dark-700 overflow-x-auto flex-shrink-0">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="px-2 py-2.5 text-muted hover:text-white hover:bg-dark-700/50 transition border-r border-dark-700 flex-shrink-0"
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {isMobile ? <Menu className="w-4 h-4" /> : (sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />)}
          </button>
          
          {tabs.map(tab => (
            <div
              key={tab.path}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer border-r border-dark-700 min-w-0 transition flex-shrink-0
                ${activeTab === tab.path ? 'bg-[#060e0d] text-white' : 'text-muted hover:text-dark-200 hover:bg-dark-800'}`}
              onClick={() => setActiveTab(tab.path)}
            >
              {tab.modified && <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />}
              <span className="truncate max-w-[100px] md:max-w-[120px]">{tab.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
                className="p-0.5 rounded hover:bg-dark-600 text-subtle hover:text-white flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          {/* Actions - pushed to right */}
          <div className="ml-auto flex items-center gap-1.5 px-2 flex-shrink-0">
            {/* Select All */}
            {activeTabData && (
              <button
                onClick={() => {
                  if (editorRef.current) {
                    const model = editorRef.current.getModel();
                    if (model) {
                      const range = model.getFullModelRange();
                      editorRef.current.setSelection(range);
                      editorRef.current.focus();
                    }
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-subtle hover:text-dark-300 transition border border-transparent hover:border-dark-600"
                title="Select All (Ctrl+A)"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Select All</span>
              </button>
            )}
            {/* Save button */}
            {activeTabData?.modified && (
              <button
                onClick={() => saveFile(activeTab)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition"
                title="Save (Ctrl+S)"
              >
                <Save className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Save</span>
              </button>
            )}
            {/* Auto-save toggle */}
            <button
              onClick={() => setAutoSave(!autoSave)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition ${
                autoSave ? 'bg-green-400/10 text-green-400 border border-green-400/20' : 'text-subtle hover:text-dark-300 border border-transparent'
              }`}
              title={autoSave ? 'Auto-save ON (saves 2s after typing stops)' : 'Auto-save OFF'}
            >
              {autoSave ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Auto</span>
            </button>
          </div>
        </div>

        {/* Monaco Container */}
        <div className="flex-1 relative">
          {tabs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-subtle gap-2">
              <FileIcon className="w-12 h-12 opacity-20" />
              <span className="text-sm">Open a file from the sidebar</span>
              {isMobile && (
                <button onClick={() => setSidebarOpen(true)} className="mt-2 px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 text-xs hover:bg-dark-600 transition">
                  Open Explorer
                </button>
              )}
            </div>
          ) : (
            <div ref={containerRef} className="absolute inset-0" />
          )}
        </div>

        {/* Status Bar */}
        {activeTabData && (
          <div className="flex items-center justify-between px-3 py-1 border-t border-dark-700 bg-dark-800/30 text-[11px] text-subtle flex-shrink-0">
            <span className="truncate">{activeTabData.path}</span>
            <div className="flex items-center gap-3">
              <span className="uppercase">{activeTabData.language}</span>
              {autoSave && <span className="text-green-400/60">AUTO</span>}
              {activeTabData.modified && (
                <button onClick={() => saveFile(activeTab)} className="flex items-center gap-1 text-accent hover:text-accent-hover transition">
                  <Save className="w-3 h-3" /> Save
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Save Toast */}
      {saveToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-dark-700 border border-dark-600 rounded-xl shadow-2xl text-xs text-green-400 animate-fade-in">
          <Check className="w-4 h-4" />
          <span>Saved <strong>{saveToast}</strong></span>
        </div>
      )}
    </div>
  );
}
