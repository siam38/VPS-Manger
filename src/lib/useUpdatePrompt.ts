import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
  checkForUpdate, snoozeUpdate, skipUpdateVersion,
  type UpdateCheck, type SnoozeDuration,
} from '../lib/update';

/** Routes that own the full viewport and are usually mid-task. A modal that
 *  steals focus while you are typing a command or editing a file is hostile,
 *  so the prompt queues and appears on the next ordinary page instead. */
const SUPPRESSED = ['/terminal', '/files'];

/**
 * Owns the update prompt's *timing*. The check itself is cached server-side;
 * this only decides whether and when the modal is allowed on screen.
 */
export function useUpdatePrompt() {
  const location = useLocation();
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [open, setOpen] = useState(false);
  const shownFor = useRef<string | null>(null);

  // One check on boot. The server decides freshness, so this is cheap and does
  // not hit GitHub on every page load.
  useEffect(() => {
    let alive = true;
    checkForUpdate()
      .then(r => { if (alive) setCheck(r); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!check?.notify?.notify || !check.latestVersion) return;
    if (SUPPRESSED.includes(location.pathname)) return;
    // Once per detected version per session: leaving and returning to the
    // dashboard must not re-open a prompt you already answered.
    if (shownFor.current === check.latestVersion) return;
    shownFor.current = check.latestVersion;
    setOpen(true);
  }, [check, location.pathname]);

  // Escape closes. Registered only while open so it cannot swallow the key
  // from a page that wants it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const snooze = useCallback(async (d: SnoozeDuration) => {
    setOpen(false);
    await snoozeUpdate(d).catch(() => {});
  }, []);

  const skip = useCallback(async () => {
    setOpen(false);
    if (check?.latestVersion) await skipUpdateVersion(check.latestVersion).catch(() => {});
  }, [check]);

  return { check, open, close: () => setOpen(false), snooze, skip };
}
