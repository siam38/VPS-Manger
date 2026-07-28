import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, RotateCcw } from 'lucide-react';
import { fetchUpdateStatus, STEP_LABELS, type UpdateStatus } from '../lib/update';

/**
 * Live progress for a running update.
 *
 * The hard part: partway through, the panel restarts and this page's own
 * server disappears. A failed poll is therefore the *expected* state, not an
 * error — it is treated as "still working" until the server answers again.
 */
export default function UpdateProgress({ onDone }: { onDone?: (s: UpdateStatus) => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: number;

    const poll = async () => {
      const s = await fetchUpdateStatus();
      if (!alive) return;

      if (!s) {
        // Server is down mid-restart. Keep the last known step on screen.
        setUnreachable(true);
      } else {
        setUnreachable(false);
        setStatus(s);
        if (!s.running && !done.current) {
          done.current = true;
          onDone?.(s);
          // A finished update means the bundle on disk changed; reload so the
          // browser is not left running the previous build's JavaScript.
          if (s.ok) setTimeout(() => window.location.reload(), 2500);
          return;
        }
      }
      timer = window.setTimeout(poll, 2000);
    };

    poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [onDone]);

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-meta text-muted">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Starting update…
      </div>
    );
  }

  const steps = status.steps ?? Object.keys(STEP_LABELS);
  const currentIdx = steps.indexOf(status.step ?? '');
  const failed = status.running === false && status.ok === false;
  const succeeded = status.running === false && status.ok === true;

  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {succeeded ? <CheckCircle2 className="w-5 h-5 text-success" aria-hidden="true" />
            : failed ? <XCircle className="w-5 h-5 text-danger" aria-hidden="true" />
            : <Loader2 className="w-5 h-5 text-accent animate-spin" aria-hidden="true" />}
        </div>
        <div className="min-w-0">
          <div className="text-body text-ink">{status.message}</div>
          <div className="text-label text-muted mt-0.5 font-mono tabular">
            v{status.fromVersion} → v{status.toVersion}
          </div>
          {unreachable && status.running && (
            <div className="text-label text-warning mt-1">
              Panel is restarting — this page will reconnect on its own.
            </div>
          )}
        </div>
      </div>

      {!failed && !succeeded && (
        <ol className="space-y-1.5">
          {steps.filter(s => s !== 'done').map((s, i) => {
            const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'todo';
            return (
              <li key={s} className="flex items-center gap-2.5 text-meta">
                <span
                  aria-hidden="true"
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    state === 'done' ? 'bg-success'
                      : state === 'active' ? 'bg-accent animate-pulse'
                      : 'bg-line-strong'
                  }`}
                />
                <span className={state === 'todo' ? 'text-muted' : 'text-ink'}>
                  {STEP_LABELS[s] ?? s}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {failed && (
        <div className="space-y-2">
          <div className="text-meta text-danger">{status.error}</div>
          {status.rolledBack && (
            <div className="flex items-center gap-2 text-meta text-muted">
              <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
              The previous version was restored automatically.
            </div>
          )}
        </div>
      )}

      {status.log?.length ? (
        <details className="text-label">
          <summary className="text-muted cursor-pointer hover:text-ink">Show log</summary>
          <pre className="mt-2 p-3 bg-canvas border border-line rounded-control overflow-x-auto
                          text-muted font-mono leading-relaxed max-h-56 overflow-y-auto">
            {status.log.join('\n')}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
