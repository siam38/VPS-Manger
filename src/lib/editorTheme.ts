import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * Editor theme, derived from the panel's own tokens rather than a stock
 * one-dark import — the editor should look like part of the product, not a
 * pasted-in widget.
 *
 * Colours match tailwind.config.js: canvas #070d0d, surface #0e1614,
 * line #1e2c2a, ink #e8f2f0, accent #14b8a6.
 */

const C = {
  canvas: '#070d0d',
  surface: '#0e1614',
  raised: '#16211f',
  line: '#1e2c2a',
  lineStrong: '#2c3d3a',
  ink: '#e8f2f0',
  muted: '#7da19c',
  subtle: '#5a7f7b',
  accent: '#14b8a6',
  accentHover: '#2dd4bf',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#06b6d4',
  violet: '#c084fc',
};

export const foxclawTheme = EditorView.theme(
  {
    '&': {
      color: C.ink,
      backgroundColor: C.canvas,
      height: '100%',
    },
    '.cm-content': {
      caretColor: C.accent,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
      padding: '8px 0 40vh 0', // trailing space so the last line clears the mobile keyboard
    },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
      lineHeight: '1.6',
      overscrollBehavior: 'contain',
      WebkitOverflowScrolling: 'touch',
    },
    '&.cm-focused': { outline: 'none' },

    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: C.accent,
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(20, 184, 166, 0.22)',
    },
    '.cm-selectionMatch': { backgroundColor: 'rgba(20, 184, 166, 0.14)' },

    '.cm-activeLine': { backgroundColor: 'rgba(26, 43, 42, 0.35)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(26, 43, 42, 0.5)',
      color: C.muted,
    },

    '.cm-gutters': {
      backgroundColor: C.canvas,
      color: '#2a3f3d',
      border: 'none',
      borderRight: `1px solid ${C.line}`,
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px' },
    '.cm-foldGutter .cm-gutterElement': { color: C.subtle },

    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(20, 184, 166, 0.2)',
      outline: `1px solid ${C.accent}`,
      color: 'inherit',
    },
    '.cm-nonmatchingBracket': { color: C.danger },

    // Search panel — restyled so it does not look like a stock browser bar.
    '.cm-panels': {
      backgroundColor: C.surface,
      color: C.ink,
      borderTop: `1px solid ${C.line}`,
    },
    '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${C.line}` },
    '.cm-panel': { padding: '6px 8px' },
    '.cm-panel input, .cm-panel button, .cm-panel select': {
      fontFamily: 'Inter, system-ui, sans-serif',
    },
    '.cm-textfield': {
      backgroundColor: C.canvas,
      border: `1px solid ${C.line}`,
      borderRadius: '6px',
      color: C.ink,
      padding: '4px 8px',
    },
    '.cm-textfield:focus': { outline: 'none', borderColor: C.accent },
    '.cm-button': {
      backgroundColor: C.raised,
      backgroundImage: 'none',
      border: `1px solid ${C.line}`,
      borderRadius: '6px',
      color: C.ink,
      padding: '4px 10px',
    },
    '.cm-button:hover': { borderColor: C.lineStrong },
    '.cm-panel.cm-search label': { color: C.muted, fontSize: '12px' },

    '.cm-searchMatch': { backgroundColor: 'rgba(245, 158, 11, 0.25)' },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(245, 158, 11, 0.5)',
    },

    // Autocomplete
    '.cm-tooltip': {
      backgroundColor: C.surface,
      border: `1px solid ${C.line}`,
      borderRadius: '8px',
      overflow: 'hidden',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: '12px',
      maxHeight: '14em',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'rgba(20, 184, 166, 0.15)',
      color: C.ink,
    },
    '.cm-completionIcon': { color: C.muted },

    // Lint
    '.cm-diagnostic-error': { borderLeftColor: C.danger },
    '.cm-diagnostic-warning': { borderLeftColor: C.warning },
    '.cm-diagnostic-info': { borderLeftColor: C.info },

    '.cm-placeholder': { color: '#3d5955' },

    // Bigger hit areas for touch.
    '@media (max-width: 768px)': {
      '.cm-content': { fontSize: '13px' },
      '.cm-button': { padding: '8px 12px' },
      '.cm-textfield': { padding: '8px 10px' },
    },
  },
  { dark: true }
);

export const foxclawHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#4a6764', fontStyle: 'italic' },
  { tag: [t.lineComment, t.blockComment, t.docComment], color: '#4a6764', fontStyle: 'italic' },

  { tag: [t.keyword, t.modifier, t.controlKeyword, t.moduleKeyword], color: C.violet },
  { tag: [t.operatorKeyword, t.definitionKeyword], color: C.violet },
  { tag: t.operator, color: '#9fc4c0' },

  { tag: [t.string, t.special(t.string)], color: '#4ade80' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#fbbf24' },
  { tag: [t.regexp, t.escape], color: '#fb923c' },

  { tag: [t.variableName, t.propertyName], color: C.ink },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#7dd3fc' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#60a5fa' },

  { tag: [t.typeName, t.className, t.namespace], color: '#5eead4' },
  { tag: [t.tagName, t.angleBracket], color: '#38bdf8' },
  { tag: t.attributeName, color: '#a5b4fc' },
  { tag: t.attributeValue, color: '#4ade80' },

  { tag: [t.meta, t.processingInstruction], color: C.muted },
  { tag: t.labelName, color: '#f9a8d4' },
  { tag: t.invalid, color: C.danger, textDecoration: 'underline wavy' },

  // Markdown
  { tag: t.heading, color: C.accentHover, fontWeight: '600' },
  { tag: t.strong, color: C.ink, fontWeight: '700' },
  { tag: t.emphasis, color: C.ink, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: C.muted },
  { tag: t.link, color: C.accent, textDecoration: 'underline' },
  { tag: t.url, color: C.accent },
  { tag: t.quote, color: C.muted, fontStyle: 'italic' },
  { tag: t.monospace, color: '#fbbf24' },
  { tag: t.list, color: C.accent },

  { tag: t.inserted, color: C.success },
  { tag: t.deleted, color: C.danger },
  { tag: t.changed, color: C.warning },
]);

export const foxclawEditorTheme: Extension = [
  foxclawTheme,
  syntaxHighlighting(foxclawHighlight),
];
