import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertCircle, ShieldCheck, ArrowRight } from 'lucide-react';
import Footer from '../components/Footer';

interface Props { onLogin: (token: string, expiresIn?: number) => void; }

/**
 * Sign-in.
 *
 * The previous version was a bare card with a lone password field floating in
 * the middle of a black page — functional, but it gave no sense of what you
 * were signing into or that the box was reachable at all.
 *
 * Two changes carry the redesign:
 *
 *  - A branded panel beside the form on desktop, stating what this is and what
 *    it manages. On mobile it collapses to a compact header, because a marketing
 *    column above a password field on a phone is just an obstacle.
 *  - The form now says what happens after: sessions persist, so this is a
 *    once-a-month interaction rather than an every-15-minutes tax.
 */
export default function Login({ onLogin }: Props) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.1.0';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        // The server replies with a Set-Cookie carrying the httpOnly refresh
        // token. Without credentials:'include' the browser would discard it and
        // the session would silently die 15 minutes later.
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        onLogin(data.token, data.expiresIn);
      } else {
        setError(data.error || 'That password was not accepted.');
      }
    } catch {
      setError('Could not reach the server. Check that the panel is running.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-canvas">
      {/* A single soft accent wash. One light source, not a gradient mesh —
          the panel's whole design rule is that colour has to mean something,
          and this is the one place it is allowed to just be atmosphere. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.35]"
        style={{
          background:
            'radial-gradient(60rem 40rem at 20% -10%, rgba(20,184,166,0.16), transparent 60%),' +
            'radial-gradient(50rem 30rem at 100% 100%, rgba(13,148,136,0.10), transparent 55%)',
        }}
      />

      <div className="relative flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-[880px] grid lg:grid-cols-[1.05fr_1fr] gap-8 items-center">

          {/* Brand column — desktop only. */}
          <div className="hidden lg:block">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-card bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
                <span className="text-page leading-none" aria-hidden="true">🦊</span>
              </div>
              <div>
                <h1 className="text-page font-semibold text-ink leading-tight">Fox VPS Manager</h1>
                <p className="text-meta text-muted leading-tight font-mono tabular">
                  v{version}
                </p>
              </div>
            </div>

            <p className="text-body text-subtle leading-relaxed max-w-[38ch] mb-7">
              Files, shell, processes and deployments for this server — from one
              place, on any device.
            </p>

            <ul className="space-y-2.5">
              {[
                'Full terminal with a real PTY',
                'Editor with syntax highlighting',
                'PM2 apps, logs and boot persistence',
                'Git sync and one-command deploys',
              ].map(item => (
                <li key={item} className="flex items-start gap-2.5 text-body text-muted">
                  <span
                    className="w-1 h-1 rounded-full bg-accent mt-[0.6rem] shrink-0"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Form column. */}
          <div className="w-full max-w-[380px] mx-auto lg:mx-0 lg:ml-auto">
            <div className="card p-7 max-sm:p-6 shadow-2xl shadow-black/40">
              {/* Compact brand header, mobile only — the column above is hidden
                  there, and an unlabelled password box is disorienting. */}
              <div className="lg:hidden flex items-center gap-2.5 mb-6">
                <div className="w-9 h-9 rounded-card bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
                  <span className="text-title leading-none" aria-hidden="true">🦊</span>
                </div>
                <div>
                  <h1 className="text-title font-semibold text-ink leading-tight">Fox VPS Manager</h1>
                  <p className="text-label text-muted leading-tight font-mono tabular">v{version}</p>
                </div>
              </div>

              <div className="max-lg:hidden mb-6">
                <h2 className="text-title font-semibold text-ink">Sign in</h2>
                <p className="text-meta text-muted mt-0.5">
                  Enter the panel password to continue.
                </p>
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
                      className="field h-11 pl-9 pr-11"
                      placeholder="Enter password"
                      autoFocus
                      autoComplete="current-password"
                      aria-invalid={!!error}
                      aria-describedby={error ? 'login-error' : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShow(!show)}
                      aria-label={show ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-control text-subtle hover:text-ink hover:bg-raised transition-colors"
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

                <button
                  type="submit"
                  disabled={loading || !password}
                  className="btn btn-primary w-full h-11 group"
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-canvas/40 border-t-canvas rounded-full animate-spin" />
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="w-4 h-4 transition-transform duration-150 motion-safe:group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>

              {/* Says why you will not be asked again tomorrow. The old panel
                  expired every 30 minutes with no explanation, which read as
                  breakage rather than policy. */}
              <div className="mt-6 pt-5 border-t border-line flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-accent shrink-0 mt-px" aria-hidden="true" />
                <p className="text-meta text-muted leading-snug">
                  This device stays signed in for 30 days. Sign out any time to
                  end the session everywhere.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative">
        <Footer />
      </div>
    </div>
  );
}
