import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Login from './pages/Login';
import Layout from './components/Layout';
import { disconnectSocket } from './lib/socket';
import { ToastProvider } from './lib/toast';

// Route-level code splitting: each page (and its heavy deps - Monaco, xterm,
// recharts) is fetched on demand instead of shipping in the initial bundle.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const FileManager = lazy(() => import('./pages/FileManager'));
const Terminal = lazy(() => import('./pages/Terminal'));
const Processes = lazy(() => import('./pages/Processes'));
const PM2Manager = lazy(() => import('./pages/PM2Manager'));
const GitSync = lazy(() => import('./pages/GitSync'));

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
  const [token, setToken] = useState<string | null>(localStorage.getItem('vps_token'));
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) { setChecking(false); return; }
    fetch('/api/verify', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.ok) { setVerified(true); } else { localStorage.removeItem('vps_token'); setToken(null); } })
      .catch(() => { localStorage.removeItem('vps_token'); setToken(null); })
      .finally(() => setChecking(false));
  }, [token]);

  const handleLogin = (t: string) => {
    localStorage.setItem('vps_token', t);
    setToken(t);
    setVerified(true);
  };

  const handleLogout = () => {
    // Tear down the authenticated socket before dropping the token, otherwise
    // the previous session's connection stays open server-side.
    disconnectSocket();
    localStorage.removeItem('vps_token');
    setToken(null);
    setVerified(false);
  };

  if (checking) {
    return (
      <ErrorBoundary>
        <div className="h-screen flex items-center justify-center bg-dark-900">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-dark-300 text-sm">Loading...</span>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  if (!token || !verified) {
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout>
      </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
