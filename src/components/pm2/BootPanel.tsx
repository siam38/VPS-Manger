import { useState } from 'react';
import {
  AlertTriangle, CheckCircle2, HardDriveDownload, Info, Loader2, Power, Save, X,
} from 'lucide-react';
import { apiPost } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { type BootStatus, formatWhen } from '../../lib/pm2';

interface Props {
  boot: BootStatus | null;
  apps: string[];
  onClose: () => void;
  onChanged: () => void;
}

/**
 * Boot persistence.
 *
 * "Will my apps come back after a reboot?" is three separate questions, and
 * the old UI answered none of them. It had a single `Startup` button that
 * shelled out to `pm2 startup` and reported success unconditionally — even on
 * a host with no systemd, where the unit it writes can never run.
 *
 * The three layers, stated separately because conflating them is exactly how
 * people lose processes:
 *
 *   1. Does the PM2 daemon start at boot?      (init-system level)
 *   2. Is the process list saved to disk?      (`pm2 save` → dump file)
 *   3. Does an app restart when it crashes?    (per-app autorestart — NOT boot)
 *
 * Both 1 and 2 must be true or nothing comes back. The panel now says which
 * one is missing instead of showing a green checkmark and hoping.
 */
export function BootPanel({ boot, apps, onClose, onChanged }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState('');

  const setBoot = async (enabled: boolean) => {
    setBusy(enabled ? 'enable' : 'disable');
    try {
      await apiPost('/api/pm2/boot-config', { enabled });
      toast.success({
        title: enabled ? 'Boot start enabled' : 'Boot start disabled',
        description: enabled
          ? 'PM2 will restore the saved process list at boot.'
          : 'PM2 will no longer start automatically.',
      });
      onChanged();
    } catch (e: any) {
      toast.error({ title: 'Could not change boot configuration', description: e.message });
    }
    setBusy('');
  };

  const save = async () => {
    setBusy('save');
    try {
      await apiPost('/api/pm2/save', {});
      toast.success({
        title: 'Process list saved',
        description: 'These apps will be restored at boot.',
      });
      onChanged();
    } catch (e: any) {
      toast.error({ title: 'Save failed', description: e.message });
    }
    setBusy('');
  };

  const resurrect = async () => {
    setBusy('resurrect');
    try {
      await apiPost('/api/pm2/resurrect', {});
      toast.success({ title: 'Saved apps restored' });
      onChanged();
    } catch (e: any) {
      toast.error({ title: 'Restore failed', description: e.message });
    }
    setBusy('');
  };

  // Apps running right now that are absent from the dump — these are the ones
  // that silently vanish on reboot, and nothing used to tell you.
  const unsaved = boot ? apps.filter(a => !boot.savedApps.includes(a)) : [];
  const ready = !!boot?.daemonAtBoot && !!boot?.dumpExists && unsaved.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-canvas border border-line w-full sm:max-w-lg max-h-[92vh] sm:max-h-[85vh]
                      rounded-t-modal sm:rounded-modal overflow-hidden flex flex-col shadow-2xl animate-slide-up">

        <div className="flex items-center justify-between px-4 sm:px-5 h-14 border-b border-line shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Power className="w-4 h-4 text-muted shrink-0" strokeWidth={1.5} aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="text-body font-semibold text-ink">Start on boot</h3>
              <p className="text-label text-subtle truncate">
                Restore these apps after a reboot
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon !w-9 !h-9" aria-label="Close">
            <X className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 sm:p-5 space-y-4">
          {!boot ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-accent animate-spin" aria-hidden="true" />
            </div>
          ) : (
            <>
              {/* Overall verdict, in plain words rather than a checkmark. */}
              <div className={`rounded-card border p-3.5 ${
                ready ? 'border-emerald-400/25 bg-emerald-400/5' : 'border-amber-400/25 bg-amber-400/5'
              }`}>
                <div className="flex items-start gap-2.5">
                  {ready
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" strokeWidth={1.5} aria-hidden="true" />
                    : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" strokeWidth={1.5} aria-hidden="true" />}
                  <div className="min-w-0">
                    <p className={`text-body font-medium ${ready ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {ready
                        ? 'Your apps will come back after a reboot'
                        : 'Your apps will NOT all come back after a reboot'}
                    </p>
                    {!ready && (
                      <p className="text-meta text-muted mt-1">
                        {!boot.daemonAtBoot
                          ? 'PM2 itself is not configured to start at boot.'
                          : !boot.dumpExists
                            ? 'No process list has been saved yet.'
                            : `${unsaved.length} running app${unsaved.length === 1 ? ' is' : 's are'} not in the saved list.`}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Layer 1 — the daemon */}
              <Section
                n={1}
                title="PM2 starts at boot"
                done={boot.daemonAtBoot}
                detail={
                  boot.daemonAtBoot
                    ? `Configured via ${boot.method === 'systemd' ? 'a systemd unit' : 'an @reboot cron entry'}.`
                    : 'Nothing currently starts the PM2 daemon when this machine boots.'
                }
              >
                {boot.canConfigure ? (
                  <button
                    onClick={() => setBoot(!boot.daemonAtBoot)}
                    disabled={!!busy}
                    className={`btn btn-sm ${boot.daemonAtBoot ? 'btn-quiet' : 'btn-primary'}`}
                  >
                    {busy === 'enable' || busy === 'disable'
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      : <Power className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />}
                    {boot.daemonAtBoot ? 'Disable' : 'Enable'}
                  </button>
                ) : (
                  <span className="text-label text-subtle">Unavailable on this host</span>
                )}
              </Section>

              {/* Layer 2 — the dump file */}
              <Section
                n={2}
                title="Process list saved"
                done={boot.dumpExists && unsaved.length === 0}
                detail={
                  boot.dumpExists
                    ? `${boot.savedApps.length} app${boot.savedApps.length === 1 ? '' : 's'} saved · ${formatWhen(boot.dumpSavedAt)}`
                    : 'Never saved. A reboot would restore nothing.'
                }
              >
                <button onClick={save} disabled={!!busy} className="btn btn-sm btn-primary">
                  {busy === 'save'
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    : <Save className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />}
                  Save now
                </button>
              </Section>

              {unsaved.length > 0 && (
                <div className="rounded-card border border-line bg-surface p-3">
                  <p className="eyebrow mb-1.5">Running but not saved</p>
                  <div className="flex flex-wrap gap-1.5">
                    {unsaved.map(n => (
                      <span key={n} className="pill pill-warn font-mono">{n}</span>
                    ))}
                  </div>
                  <p className="text-meta text-muted mt-2">
                    These are running now but absent from the saved list, so a reboot would lose them.
                    Save to include them.
                  </p>
                </div>
              )}

              {boot.savedApps.length > 0 && (
                <div className="rounded-card border border-line bg-surface p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="eyebrow">Saved list</p>
                    <button onClick={resurrect} disabled={!!busy} className="btn btn-sm btn-quiet">
                      {busy === 'resurrect'
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        : <HardDriveDownload className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />}
                      Restore now
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {boot.savedApps.map(n => (
                      <span key={n} className="pill pill-neutral font-mono">{n}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Host reality. This is where we refuse to pretend. */}
              {boot.warnings.length > 0 && (
                <div className="rounded-card border border-line bg-surface p-3 space-y-2">
                  <p className="eyebrow flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
                    About this host
                  </p>
                  {boot.warnings.map((w, i) => (
                    <p key={i} className="text-meta text-muted leading-relaxed">{w}</p>
                  ))}
                </div>
              )}

              <dl className="rounded-card border border-line bg-surface divide-y divide-line/70">
                <Row k="Init system" v={boot.init === 'systemd' ? 'systemd' : `${boot.init} (PID 1: ${boot.pid1 || '?'})`} />
                <Row k="Boot method" v={boot.method === 'none' ? 'not configured' : boot.method} />
                <Row k="PM2_HOME" v={boot.pm2Home} />
                {boot.pm2HomeMismatch && <Row k="Expected" v={boot.expectedPm2Home} warn />}
              </dl>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  n, title, done, detail, children,
}: {
  n: number; title: string; done: boolean; detail: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <span
          className={`shrink-0 w-5 h-5 rounded-full grid place-items-center text-label font-semibold ${
            done ? 'bg-emerald-400/15 text-emerald-400' : 'bg-raised text-subtle'
          }`}
          aria-hidden="true"
        >
          {done ? '✓' : n}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-ink">{title}</p>
          <p className="text-meta text-muted mt-0.5">{detail}</p>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 h-10">
      <dt className="text-meta text-muted shrink-0">{k}</dt>
      <dd className={`text-meta font-mono truncate ${warn ? 'text-amber-400' : 'text-ink'}`}>{v}</dd>
    </div>
  );
}
