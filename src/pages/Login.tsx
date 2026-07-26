import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

interface Props { onLogin: (token: string) => void; }

export default function Login({ onLogin }: Props) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        onLogin(data.token);
      } else {
        setError(data.error || 'That password was not accepted.');
      }
    } catch {
      setError('Could not reach the server. Check that the panel is running.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[380px] card p-8">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-card bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
            <span className="text-accent text-title font-bold leading-none">V</span>
          </div>
          <div>
            <h1 className="text-title font-semibold text-ink leading-tight">VPS Manager</h1>
            <p className="text-meta text-muted leading-tight">Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="eyebrow block mb-2">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none" />
              <input
                id="password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="field h-10 pl-9 pr-11"
                placeholder="Enter password"
                autoFocus
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-8 h-8 rounded-control text-subtle hover:text-ink hover:bg-raised transition-colors"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div
              id="login-error"
              role="alert"
              className="flex items-start gap-2 px-3 py-2 rounded-control bg-danger/10 border border-danger/25"
            >
              <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-px" />
              <span className="text-meta text-danger">{error}</span>
            </div>
          )}

          <button type="submit" disabled={loading || !password} className="btn btn-primary w-full h-10">
            {loading
              ? <span className="w-4 h-4 border-2 border-canvas/40 border-t-canvas rounded-full animate-spin" />
              : 'Sign in'}
          </button>
        </form>

        <p className="text-label text-muted text-center mt-8">
          VPS Manager v3.1
        </p>
      </div>
    </div>
  );
}
