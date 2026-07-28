import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Login from './pages/Login';
import Layout from './components/Layout';
import UpdateModal from './components/UpdateModal';
import { useUpdatePrompt } from './lib/useUpdatePrompt';
import { disconnectSocket } from './lib/socket';
import { ToastProvider } from './lib/toast';
import { bootstrap, logout as authLogout, onAuthChange, setToken } from './lib/auth';

// Route-level code splitting: each page (and its heavy deps - Monaco, xterm,
// recharts) is fetched on demand instead of shipping in the initial bundle.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const FileManager = lazy(() => import('./pages/FileManager'));
const Terminal = lazy(() => import('./pages/Terminal'));
const Processes = lazy(() => import('./pages/Processes'));
const PM2Manager = lazy(() => import('./pages/PM2Manager'));
const GitSync = lazy(() => import('./pages/GitSync'));
const Settings = lazy(() => import('./pages/Settings'));

function RouteFallback() {
  return (
    <div className="h-full min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// Error Boundary Component
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex items-center justify-center bg-dark-900 px-4">
          <div className="max-w-md w-full bg-dark-800 border border-red-500/30 rounded-2xl p-6 shadow-lg">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
                <p className="text-muted text-sm">
                  {this.state.error?.message || 'An unexpected error occurred'}
                </p>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg transition"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  // One boot check: try the stored access token, then fall back to the
  // httpOnly refresh cookie. The second path is the one that matters after
  // the tab has been closed longer than the access token's lifetime.
  useEffect(() => {
    let alive = true;
    bootstrap()
      .then(ok => { if (alive) setAuthed(ok); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  // The session can end from outside this component: a revoked refresh token,
  // or a sign-out in another tab. Both surface through this listener.
  useEffect(() => onAuthChange(token => {
    if (!token) { disconnectSocket(); setAuthed(false); }
  }), []);

  const handleLogin = (token: string, expiresIn?: number) => {
    setToken(token, expiresIn ?? 900);
    setAuthed(true);
  };

  const handleLogout = async () => {
    // Tear down the authenticated socket before dropping credentials, otherwise
    // the previous session's connection stays open server-side.
    disconnectSocket();
    await authLogout(); // revokes the refresh token family on the server too
    setAuthed(false);
  };

  if (checking) {
    return (
      <ErrorBoundary>
        <div className="h-screen flex items-center justify-center bg-canvas">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-muted text-meta">Restoring session…</span>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  if (!authed) {
    return (
      <ErrorBoundary>
        <ToastProvider>
          <Login onLogin={handleLogin} />
        </ToastProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
      <BrowserRouter>
        <Layout onLogout={handleLogout}>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/files" element={<FileManager />} />
              <Route path="/terminal" element={<Terminal />} />
              <Route path="/processes" element={<Processes />} />
              <Route path="/pm2" element={<PM2Manager />} />
              <Route path="/git" element={<GitSync />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout>
        {/* Inside the router: the prompt's timing depends on the current route. */}
        <UpdateGate />
      </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}

/** Kept separate so the update check mounts inside the router and can suppress
 *  itself on the full-viewport routes. */
function UpdateGate() {
  const { check, open, close, snooze, skip } = useUpdatePrompt();
  if (!open || !check) return null;
  return (
    <UpdateModal
      check={check}
      onClose={close}
      onSnooze={snooze}
      onSkip={skip}
      onUpdate={() => { window.location.href = '/settings'; }}
    />
  );
}

export default App;
