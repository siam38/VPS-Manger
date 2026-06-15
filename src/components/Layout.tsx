import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, FolderOpen, Terminal, Cpu, Boxes, Code2, GitBranch,
  LogOut, Menu, X, ChevronRight, Heart, Zap, Shield, Activity, Server, Globe
} from 'lucide-react';

interface Props { children: React.ReactNode; onLogout: () => void; }

const NAV = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', color: 'text-blue-400' },
  { path: '/files', icon: FolderOpen, label: 'Files', color: 'text-green-400' },
  { path: '/terminal', icon: Terminal, label: 'Terminal', color: 'text-cyan-400' },
  { path: '/processes', icon: Cpu, label: 'Processes', color: 'text-orange-400' },
  { path: '/pm2', icon: Boxes, label: 'PM2', color: 'text-violet-400' },
  { path: '/git', icon: GitBranch, label: 'Git Sync', color: 'text-pink-400' },
];

export default function Layout({ children, onLogout }: Props) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="h-screen h-[100dvh] flex bg-dark-900 overflow-hidden lg:overflow-hidden max-lg:overflow-y-auto max-lg:flex-col">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50
        lg:static
        ${collapsed ? 'w-[68px]' : 'w-60'}
        bg-dark-800 border-r border-dark-700 flex flex-col transition-all duration-200
        ${sidebarOpen ? 'translate-x-0 slide-in' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Header */}
        <div className={`flex items-center h-14 px-4 border-b border-dark-700 ${collapsed ? 'justify-center' : 'gap-3'}`}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/20 to-accent/10 flex items-center justify-center border border-accent/30">
                <Zap className="w-4 h-4 text-accent" />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-white text-sm">VPS Manager</span>
                <span className="text-[10px] text-dark-500">v3.0</span>
              </div>
            </div>
          )}
          {collapsed && (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/20 to-accent/10 flex items-center justify-center border border-accent/30">
              <Zap className="w-4 h-4 text-accent" />
            </div>
          )}
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden ml-auto text-dark-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          {NAV.map(({ path, icon: Icon, label, color }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                  ${active 
                    ? 'bg-accent/10 text-accent border border-accent/20 shadow-lg shadow-accent/5' 
                    : 'text-dark-300 hover:text-white hover:bg-dark-700/50 border border-transparent'
                  }
                  ${collapsed ? 'justify-center px-2' : ''}
                `}
                title={collapsed ? label : undefined}
              >
                <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${active ? 'text-accent' : color}`} />
                {!collapsed && (
                  <div className="flex items-center gap-2 flex-1">
                    <span>{label}</span>
                    {active && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-2 border-t border-dark-700 space-y-1">
          {/* System Status */}
          {!collapsed && (
            <div className="px-3 py-2 bg-dark-900/50 rounded-lg">
              <div className="flex items-center gap-2 text-[10px] text-dark-400 mb-1">
                <Activity className="w-3 h-3" />
                <span>System Status</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] text-green-400">Online</span>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex items-center gap-3 w-full px-3 py-2 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700/50 text-sm transition"
          >
            <ChevronRight className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
            {!collapsed && <span>Collapse</span>}
          </button>
          <button
            onClick={onLogout}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-400/10 text-sm transition ${collapsed ? 'justify-center px-2' : ''}`}
          >
            <LogOut className="w-[18px] h-[18px]" />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 lg:overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-dark-700 bg-dark-800/50 backdrop-blur flex-shrink-0 max-lg:sticky max-lg:top-0 max-lg:z-30">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-dark-400 hover:text-white">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              {NAV.find(n => n.path === location.pathname)?.icon && (
                <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                  {React.createElement(NAV.find(n => n.path === location.pathname)?.icon!, { className: `w-4 h-4 ${NAV.find(n => n.path === location.pathname)?.color}` })}
                </div>
              )}
              <h1 className="text-white font-semibold text-sm">
                {NAV.find(n => n.path === location.pathname)?.label || 'Panel'}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-dark-900/50 rounded-lg border border-dark-700">
              <Shield className="w-3.5 h-3.5 text-green-400" />
              <span className="text-[11px] text-dark-400">v3.0</span>
            </div>
            <div className="hidden md:flex items-center gap-2 text-[10px] text-dark-500">
              <Globe className="w-3 h-3" />
              <span>{currentTime.toLocaleTimeString()}</span>
            </div>
          </div>
        </header>
        
        {/* Content */}
        <main className="flex-1 lg:overflow-auto max-lg:overflow-visible">
          {children}
        </main>
      </div>
    </div>
  );
}
