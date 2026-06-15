import React, { useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket';
import { Plus, X } from 'lucide-react';

interface Tab {
  id: string;
  terminalId: string | null;
  label: string;
}

export default function Terminal() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const termsRef = useRef<Map<string, { term: any; fitAddon: any; el: HTMLDivElement }>>(new Map());
  const xtermLoaded = useRef(false);
  const [xtermReady, setXtermReady] = useState(false);

  // Load xterm dynamically
  useEffect(() => {
    if (xtermLoaded.current) return;
    xtermLoaded.current = true;

    const loadModules = async () => {
      const [xtermMod, fitMod, linksMod] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ]);
      (window as any).__xterm = xtermMod;
      (window as any).__xtermFit = fitMod;
      (window as any).__xtermLinks = linksMod;
      setXtermReady(true);
    };
    loadModules();

    // Load CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css';
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    if (xtermReady && tabs.length === 0) {
      createTab();
    }
  }, [xtermReady]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      const active = termsRef.current.get(activeTab || '');
      if (active) {
        try { active.fitAddon.fit(); } catch {}
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [activeTab]);

  const createTab = () => {
    const id = `tab_${Date.now()}`;
    const tab: Tab = { id, terminalId: null, label: `Terminal ${tabs.length + 1}` };
    setTabs(prev => [...prev, tab]);
    setActiveTab(id);

    // Initialize terminal after render
    setTimeout(() => initTerminal(id), 50);
  };

  const initTerminal = (tabId: string) => {
    const { Terminal: XTerm } = (window as any).__xterm;
    const { FitAddon } = (window as any).__xtermFit;
    const { WebLinksAddon } = (window as any).__xtermLinks;

    const el = document.createElement('div');
    el.className = 'w-full h-full';
    
    const termContainer = document.getElementById(`term-${tabId}`);
    if (!termContainer) return;
    termContainer.innerHTML = '';
    termContainer.appendChild(el);

    const fitAddon = new FitAddon();
    const term = new XTerm({
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: {
        background: '#060e0d',
        foreground: '#d6e7e5',
        cursor: '#14b8a6',
        cursorAccent: '#060e0d',
        selectionBackground: '#14b8a633',
        black: '#0d1917',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#06b6d4',
        magenta: '#a855f7',
        cyan: '#14b8a6',
        white: '#d6e7e5',
        brightBlack: '#3d5955',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#22d3ee',
        brightMagenta: '#c084fc',
        brightCyan: '#2dd4bf',
        brightWhite: '#f0fdfa',
      }
    });
    
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    
    try { fitAddon.fit(); } catch {}

    const socket = getSocket();
    
    socket.emit('terminal:create', { cols: term.cols, rows: term.rows }, (res: any) => {
      if (res.success) {
        setTabs(prev => prev.map(t => t.id === tabId ? { ...t, terminalId: res.terminalId } : t));
        
        term.onData(data => {
          socket.emit('terminal:input', { terminalId: res.terminalId, input: data });
        });

        term.onResize(({ cols, rows }) => {
          socket.emit('terminal:resize', { terminalId: res.terminalId, cols, rows });
        });

        const handler = (data: { terminalId: string; data: string }) => {
          if (data.terminalId === res.terminalId) term.write(data.data);
        };
        socket.on('terminal:data', handler);

        termsRef.current.set(tabId, { term, fitAddon, el });
      }
    });
  };

  const closeTab = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab?.terminalId) {
      const socket = getSocket();
      socket.emit('terminal:destroy', { terminalId: tab.terminalId });
    }
    const termData = termsRef.current.get(tabId);
    if (termData) { termData.term.dispose(); termsRef.current.delete(tabId); }
    
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId);
      if (activeTab === tabId && next.length > 0) {
        setActiveTab(next[next.length - 1].id);
      }
      return next;
    });
  };

  // Fit active terminal on tab switch
  useEffect(() => {
    if (!activeTab) return;
    setTimeout(() => {
      const active = termsRef.current.get(activeTab);
      if (active) {
        try { active.fitAddon.fit(); active.term.focus(); } catch {}
      }
    }, 50);
  }, [activeTab]);

  if (!xtermReady) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Tab bar */}
      <div className="flex items-center bg-dark-800/50 border-b border-dark-700 overflow-x-auto">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer border-r border-dark-700 min-w-0 transition
              ${activeTab === tab.id ? 'bg-dark-900 text-white' : 'text-dark-400 hover:text-dark-200 hover:bg-dark-800'}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="truncate">{tab.label}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="p-0.5 rounded hover:bg-dark-600 text-dark-500 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={createTab}
          className="px-2 py-2 text-dark-400 hover:text-white hover:bg-dark-800 transition"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Terminal containers */}
      <div ref={containerRef} className="flex-1 relative bg-[#060e0d]">
        {tabs.map(tab => (
          <div
            key={tab.id}
            id={`term-${tab.id}`}
            className={`absolute inset-0 p-1 ${activeTab === tab.id ? '' : 'hidden'}`}
          />
        ))}
      </div>
    </div>
  );
}
