import React from 'react';
import { Heart } from 'lucide-react';

/**
 * The signature footer.
 *
 * It existed on the old panel and got dropped in the session-1 rebuild — an
 * unintended casualty of replacing the page shells, not a design decision.
 * Restored here as one component so it reads identically on every page instead
 * of being retyped per screen and drifting.
 *
 * `compact` is for the sidebar rail, where there is no room for the version
 * line beside the credit.
 *
 * The product name used to lead this line. It was redundant — the rail header
 * already states the name and version on every screen — and it made the
 * signature read like a banner instead of a credit. The footer is now only
 * the credit and the build.
 */
export default function Footer({ compact = false }: { compact?: boolean }) {
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.1.0';

  return (
    <footer
      className={`shrink-0 flex items-center justify-center gap-1.5 text-label text-muted
                  ${compact ? 'py-2' : 'py-4 px-4 border-t border-line'}`}
    >
      <span>Made by</span>
      <span className="text-ink font-medium">SiAM</span>
      <span>with</span>
      {/* The heart is the one place a non-semantic colour is allowed: it is
          decoration by intent, not a status signal. aria-hidden because
          "red heart icon" adds nothing to the sentence being read out. */}
      <Heart
        className="w-3 h-3 text-danger fill-danger motion-safe:animate-pulse"
        aria-hidden="true"
      />
      {!compact && (
        <>
          <span className="text-line-strong mx-1" aria-hidden="true">·</span>
          <span className="font-mono tabular">v{version}</span>
        </>
      )}
    </footer>
  );
}
