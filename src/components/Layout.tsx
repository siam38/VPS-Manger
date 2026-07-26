import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, Terminal, Cpu, Boxes, GitBranch,
  LogOut, Menu, X, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';

interface Props { children: React.ReactNode; onLogout: () => void; }

/**
 * Nav icons are deliberately monochrome. The previous design gave every
 * item its own hue, which spent the whole palette on decoration and left
 * nothing to signal actual state with.
 */
const NAV = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/files', icon: FolderOpen, label: 'Files' },
  { path: '/terminal', icon: Terminal, label: 'Terminal' },
  { path: '/processes', icon: Cpu, label: 'Processes' },
  { path: '/pm2', icon: Boxes, label: 'PM2' },
  { path: '/git', icon: GitBranch, label: 'Git Sync' },
];

export default function Layout({ children, onLogout }: Props) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('vps_sidebar_collapsed') === 'true'
  );

  useEffect(() => {
    localStorage.setItem('vps_sidebar_collapsed', String(collapsed));
  }, [collapsed]);

  // Close the mobile drawer on navigation.
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const current = NAV.find(n => n.path === location.pathname);

  return (
    <div className="min-h-[100dvh] lg:h-[100dvh] flex bg-canvas lg:overflow-hidden max-lg:flex-col">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 lg:static
          ${collapsed ? 'w-[64px]' : 'w-56'}
          bg-surface border-r border-line flex flex-col
          transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className={`flex items-center h-14 shrink-0 border-b border-line ${collapsed ? 'justify-center px-2' : 'px-4 gap-2.5'}`}>
          <div className="w-7 h-7 rounded-control bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
            <span className="text-accent text-body font-bold leading-none">V</span>
          </div>
          {!collapsed && (
            <span className="font-semibold text-ink text-body tracking-tight">VPS Manager</span>
          )}
          <button
            onClick={() => setSidebarOpen(false)}
            className="btn-icon lg:hidden ml-auto"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto" aria-label="Main">
          {NAV.map(({ path, icon: Icon, label }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? label : undefined}
                className={`relative flex items-center gap-3 h-10 rounded-control text-body
                  transition-colors duration-150
                  ${collapsed ? 'justify-center px-2' : 'px-3'}
                  ${active
                    ? 'bg-raised text-ink font-medium'
                    : 'text-muted hover:text-ink hover:bg-raised/60'}`}
              >
                {/* Active state reads structurally, not just by colour. */}
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-accent" />
                )}
                <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-accent' : ''}`} />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="p-2 border-t border-line space-y-0.5 shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`hidden lg:flex items-center gap-3 w-full h-9 rounded-control
              text-meta text-muted hover:text-ink hover:bg-raised transition-colors
              ${collapsed ? 'justify-center px-2' : 'px-3'}`}
          >
            {collapsed
              ? <PanelLeftOpen className="w-[18px] h-[18px] shrink-0" />
              : <PanelLeftClose className="w-[18px] h-[18px] shrink-0" />}
            {!collapsed && <span>Collapse</span>}
          </button>
          <button
            onClick={onLogout}
            aria-label="Sign out"
            className={`flex items-center gap-3 w-full h-9 rounded-control
              text-meta text-muted hover:text-ink hover:bg-raised transition-colors
              ${collapsed ? 'justify-center px-2' : 'px-3'}`}
          >
            <LogOut className="w-[18px] h-[18px] shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 lg:overflow-hidden">
        {/* Mobile-only bar. On desktop each page owns its own header, so
            the old duplicate title band is gone. */}
        <header className="lg:hidden h-14 shrink-0 flex items-center gap-3 px-3
                           border-b border-line bg-surface sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="btn-icon"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-body font-semibold text-ink">
            {current?.label ?? 'Panel'}
          </span>
        </header>

        <main className="flex-1 lg:overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
