import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { AlertTriangle, Check, Info, Loader2, X, XCircle } from 'lucide-react';

/**
 * Toast + confirm layer.
 *
 * Replaces the 19 `alert()` / `confirm()` call sites that previously blocked
 * the main thread and looked like a 1998 browser dialog. Notifications are
 * non-blocking; destructive confirmations are a real modal that can be
 * dismissed with Escape and traps nothing the user cannot escape.
 */

export type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastOptions {
  title?: string;
  description?: string;
  /** ms; 0 or negative keeps it until dismissed. Loading toasts never auto-dismiss. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
  kind: ToastKind;
  createdAt: number;
}

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Require typing this exact string before confirm unlocks. */
  requireText?: string;
}

interface ToastApi {
  toast: (kind: ToastKind, opts: ToastOptions | string) => number;
  success: (opts: ToastOptions | string) => number;
  error: (opts: ToastOptions | string) => number;
  warning: (opts: ToastOptions | string) => number;
  info: (opts: ToastOptions | string) => number;
  loading: (opts: ToastOptions | string) => number;
  update: (id: number, kind: ToastKind, opts: ToastOptions | string) => void;
  dismiss: (id: number) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 8000,
  loading: 0,
};

function normalise(opts: ToastOptions | string): ToastOptions {
  return typeof opts === 'string' ? { title: opts } : opts;
}

const KIND_META: Record<ToastKind, { Icon: any; tone: string; bar: string }> = {
  success: { Icon: Check, tone: 'text-success', bar: 'bg-success' },
  error: { Icon: XCircle, tone: 'text-danger', bar: 'bg-danger' },
  warning: { Icon: AlertTriangle, tone: 'text-warning', bar: 'bg-warning' },
  info: { Icon: Info, tone: 'text-info', bar: 'bg-info' },
  loading: { Icon: Loader2, tone: 'text-accent', bar: 'bg-accent' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [confirmState, setConfirmState] = useState<
    (ConfirmOptions & { resolve: (v: boolean) => void }) | null
  >(null);
  const [confirmInput, setConfirmInput] = useState('');
  const idRef = useRef(1);
  const timers = useRef<Map<number, any>>(new Map());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setToasts(prev => prev.filter(t2 => t2.id !== id));
  }, []);

  const schedule = useCallback((id: number, kind: ToastKind, duration?: number) => {
    const existing = timers.current.get(id);
    if (existing) { clearTimeout(existing); timers.current.delete(id); }
    const ms = duration ?? DEFAULT_DURATION[kind];
    if (ms > 0) {
      timers.current.set(id, setTimeout(() => dismiss(id), ms));
    }
  }, [dismiss]);

  const toast = useCallback((kind: ToastKind, opts: ToastOptions | string) => {
    const o = normalise(opts);
    const id = idRef.current++;
    setToasts(prev => {
      // Cap the stack so a failing loop cannot bury the screen.
      const next = [...prev, { ...o, id, kind, createdAt: Date.now() }];
      return next.slice(-4);
    });
    schedule(id, kind, o.duration);
    return id;
  }, [schedule]);

  const update = useCallback((id: number, kind: ToastKind, opts: ToastOptions | string) => {
    const o = normalise(opts);
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, ...o, kind } : t)));
    schedule(id, kind, o.duration);
  }, [schedule]);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setConfirmInput('');
    return new Promise<boolean>(resolve => {
      setConfirmState({ ...opts, resolve });
    });
  }, []);

  const settleConfirm = useCallback((value: boolean) => {
    setConfirmState(prev => { prev?.resolve(value); return null; });
    setConfirmInput('');
  }, []);

  // Escape closes the confirm dialog as a cancel.
  useEffect(() => {
    if (!confirmState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); settleConfirm(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmState, settleConfirm]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const api = useMemo<ToastApi>(() => ({
    toast,
    success: o => toast('success', o),
    error: o => toast('error', o),
    warning: o => toast('warning', o),
    info: o => toast('info', o),
    loading: o => toast('loading', o),
    update,
    dismiss,
    confirm,
  }), [toast, update, dismiss, confirm]);

  const confirmLocked =
    !!confirmState?.requireText && confirmInput !== confirmState.requireText;

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Toast viewport. Bottom-centre on mobile (thumb reach, avoids the
          top nav), bottom-right on desktop. */}
      <div
        className="pointer-events-none fixed z-[200] flex flex-col gap-2
                   bottom-4 left-4 right-4 items-stretch
                   sm:left-auto sm:right-5 sm:bottom-5 sm:w-[360px] sm:items-end"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map(t => {
          const { Icon, tone, bar } = KIND_META[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
              className="pointer-events-auto w-full overflow-hidden flex items-start gap-3
                         bg-surface border border-line rounded-card shadow-2xl
                         pl-3 pr-2 py-2.5 animate-slide-up"
            >
              <span className={`absolute left-0 top-0 h-full w-0.5 ${bar}`} aria-hidden="true" />
              <Icon
                className={`w-4 h-4 mt-0.5 shrink-0 ${tone} ${t.kind === 'loading' ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                {t.title && <p className="text-body font-medium text-ink break-words">{t.title}</p>}
                {t.description && (
                  <p className="text-meta text-muted mt-0.5 break-words whitespace-pre-wrap">
                    {t.description}
                  </p>
                )}
                {t.action && (
                  <button
                    onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                    className="mt-1.5 text-meta font-medium text-accent hover:text-accent-hover transition-colors"
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="btn-icon !w-7 !h-7 max-md:!w-8 max-md:!h-8 shrink-0"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Confirmation modal */}
      {confirmState && (
        <div
          className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center
                     bg-canvas/80 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          onMouseDown={e => { if (e.target === e.currentTarget) settleConfirm(false); }}
        >
          <div className="w-full sm:max-w-md bg-surface border border-line
                          rounded-t-modal sm:rounded-modal shadow-2xl animate-slide-up">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div
                  className={`w-9 h-9 rounded-control flex items-center justify-center shrink-0
                              ${confirmState.danger ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}
                >
                  {confirmState.danger
                    ? <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                    : <Info className="w-4 h-4" aria-hidden="true" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id="confirm-title" className="text-title font-semibold text-ink">
                    {confirmState.title}
                  </h2>
                  {confirmState.description && (
                    <p className="text-body text-muted mt-1 whitespace-pre-wrap break-words">
                      {confirmState.description}
                    </p>
                  )}
                </div>
              </div>

              {confirmState.requireText && (
                <div className="mt-4">
                  <label htmlFor="confirm-guard" className="eyebrow block mb-1.5">
                    Type <span className="font-mono text-ink">{confirmState.requireText}</span> to confirm
                  </label>
                  <input
                    id="confirm-guard"
                    autoFocus
                    value={confirmInput}
                    onChange={e => setConfirmInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !confirmLocked) settleConfirm(true);
                    }}
                    className="field font-mono"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line">
              <button className="btn btn-quiet" onClick={() => settleConfirm(false)}>
                {confirmState.cancelLabel || 'Cancel'}
              </button>
              <button
                autoFocus={!confirmState.requireText}
                disabled={confirmLocked}
                className={`btn ${confirmState.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => settleConfirm(true)}
              >
                {confirmState.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
