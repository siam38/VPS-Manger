import { useState } from 'react';
import { X, ArrowRight, ExternalLink, AlertTriangle, Clock, Download } from 'lucide-react';
import type { UpdateCheck, SnoozeDuration } from '../lib/update';

interface Props {
  check: UpdateCheck;
  onClose: () => void;
  onSnooze: (d: SnoozeDuration) => void;
  onSkip: () => void;
  onUpdate: () => void;
}

const SNOOZE: { id: SnoozeDuration; label: string }[] = [
  { id: '1h', label: '1 hour' },
  { id: '1d', label: '1 day' },
  { id: '1w', label: '1 week' },
];

/**
 * The update prompt.
 *
 * Deliberately dismissible and non-blocking: this is a server panel, and a
 * modal that traps you is the last thing you want when you opened the tab to
 * fix something urgent. Escape and the backdrop both close it.
 */
export default function UpdateModal({ check, onClose, onSnooze, onSkip, onUpdate }: Props) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const commits = check.groups.length ? check.groups : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-lg bg-surface border border-line rounded-t-2xl sm:rounded-2xl
                   shadow-2xl flex flex-col max-h-[85dvh] sm:max-h-[80dvh]"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-line shrink-0">
          <div className="w-9 h-9 rounded-control bg-accent/15 border border-accent/30
                          flex items-center justify-center shrink-0">
            <Download className="w-[18px] h-[18px] text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="update-title" className="text-ink font-semibold text-body">
              Update available
            </h2>
            {/* The version transition is the single most useful fact here, so
                it gets its own line rather than being buried in prose. */}
            <div className="flex items-center gap-2 mt-1 font-mono tabular text-meta">
              <span className="text-muted">v{check.currentVersion}</span>
              <ArrowRight className="w-3.5 h-3.5 text-line-strong" aria-hidden="true" />
              <span className="text-accent font-medium">v{check.latestVersion}</span>
              {check.prerelease && <span className="pill pill-warn ml-1">pre-release</span>}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon shrink-0" aria-label="Close update dialog">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1 min-h-0 space-y-4">
          {check.releaseNotes && (
            <p className="text-meta text-muted whitespace-pre-line leading-relaxed">
              {check.releaseNotes.slice(0, 600)}
            </p>
          )}

          {commits && (
            <div className="space-y-4">
              <div className="text-label text-muted uppercase tracking-wide">
                {check.commitCount} commit{check.commitCount === 1 ? '' : 's'} since v{check.currentVersion}
              </div>
              {commits.map(g => (
                <div key={g.type}>
                  <div className="text-label font-medium text-ink mb-1.5">{g.label}</div>
                  <ul className="space-y-1">
                    {g.commits.map(c => (
                      <li key={c.fullHash} className="flex gap-2 text-meta leading-snug">
                        <code className="text-muted font-mono tabular shrink-0">{c.hash}</code>
                        <span className="text-ink min-w-0">
                          {c.scope && <span className="text-muted">{c.scope}: </span>}
                          {c.subject}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {check.truncated && (
                <p className="text-label text-muted">
                  Showing the most recent commits only.
                </p>
              )}
            </div>
          )}

          {!commits && (
            <p className="text-meta text-muted">
              A detailed commit list is not available for this update.
            </p>
          )}

          <div className="flex items-start gap-2 text-meta text-muted bg-raised border border-line
                          rounded-control px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Installing restarts the panel. Terminal sessions will end; PM2 apps keep running.
            </span>
          </div>

          {check.releaseUrl && (
            <a
              href={check.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-meta text-accent hover:underline"
            >
              View on GitHub
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
        </div>

        <div className="border-t border-line px-5 py-4 shrink-0 space-y-2">
          <button onClick={onUpdate} className="btn btn-primary w-full justify-center">
            Update now
          </button>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <button
                onClick={() => setSnoozeOpen(v => !v)}
                aria-expanded={snoozeOpen}
                className="btn btn-quiet w-full justify-center gap-1.5"
              >
                <Clock className="w-4 h-4" aria-hidden="true" />
                Remind me
              </button>
              {snoozeOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-raised border border-line
                                rounded-control shadow-lg overflow-hidden z-10">
                  {SNOOZE.map(s => (
                    <button
                      key={s.id}
                      onClick={() => onSnooze(s.id)}
                      className="w-full text-left px-3 h-9 text-meta text-ink hover:bg-surface transition-colors"
                    >
                      In {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onSkip} className="btn btn-quiet flex-1 justify-center">
              Skip v{check.latestVersion}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
