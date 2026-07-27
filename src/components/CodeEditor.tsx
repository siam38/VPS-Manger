import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import { Compartment, EditorState, StateEffect, type Extension } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, drawSelection, dropCursor, rectangularSelection,
  crosshairCursor, highlightTrailingWhitespace, placeholder as cmPlaceholder,
} from '@codemirror/view';
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
  undo, redo, selectAll, indentMore, indentLess,
  toggleComment, cursorDocStart, cursorDocEnd,
} from '@codemirror/commands';
import {
  foldGutter, foldKeymap, indentOnInput, bracketMatching,
  indentUnit, codeFolding,
} from '@codemirror/language';
import {
  searchKeymap, highlightSelectionMatches, openSearchPanel, search,
} from '@codemirror/search';
import {
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap,
} from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';

import { foxclawEditorTheme } from '../lib/editorTheme';
import { resolveLanguage } from '../lib/editorLanguages';

export interface CodeEditorHandle {
  getValue: () => string;
  setValue: (v: string) => void;
  focus: () => void;
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
  indent: () => void;
  outdent: () => void;
  toggleComment: () => void;
  openSearch: () => void;
  goToStart: () => void;
  goToEnd: () => void;
  goToLine: (line: number) => void;
  insert: (text: string) => void;
  view: () => EditorView | null;
}

export interface CursorInfo {
  line: number;
  col: number;
  selLength: number;
  selLines: number;
  totalLines: number;
}

interface Props {
  /** Initial document. Changing `docKey` reloads the document. */
  value: string;
  /** Identity of the document — usually the file path. */
  docKey: string;
  fileName: string;
  readOnly?: boolean;
  wrap?: boolean;
  showLineNumbers?: boolean;
  fontSize?: number;
  tabSize?: number;
  useTabs?: boolean;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onCursor?: (info: CursorInfo) => void;
  className?: string;
}

/**
 * CodeMirror 6 editor.
 *
 * Replaces Monaco, which was loaded from a CDN and is effectively unusable on
 * a phone: it renders into a hidden textarea with its own scroll model, so the
 * virtual keyboard fights the viewport, selection handles do not appear, and
 * pinch-zoom is swallowed. CodeMirror 6 is contenteditable-based, so the OS
 * handles selection, caret placement, and IME natively.
 */
const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  {
    value, docKey, fileName, readOnly = false, wrap = true, showLineNumbers = true,
    fontSize = 13, tabSize = 2, useTabs = false, placeholder, onChange, onSave, onCursor,
    className = '',
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [langReady, setLangReady] = useState(false);

  // Callbacks live in refs so the editor is never torn down just because a
  // parent re-rendered with a new closure.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCursorRef = useRef(onCursor);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onCursorRef.current = onCursor; }, [onCursor]);

  // Compartments let us reconfigure single concerns without rebuilding state.
  const compartments = useMemo(() => ({
    language: new Compartment(),
    wrap: new Compartment(),
    lineNumbers: new Compartment(),
    readOnly: new Compartment(),
    fontSize: new Compartment(),
    tabSize: new Compartment(),
  }), []);

  const reportCursor = useCallback((view: EditorView) => {
    const cb = onCursorRef.current;
    if (!cb) return;
    const { state } = view;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    const fromLine = state.doc.lineAt(sel.from).number;
    const toLine = state.doc.lineAt(sel.to).number;
    cb({
      line: line.number,
      col: sel.head - line.from + 1,
      selLength: sel.to - sel.from,
      selLines: sel.empty ? 0 : toLine - fromLine + 1,
      totalLines: state.doc.lines,
    });
  }, []);

  // ── Build the editor once per document ────────────────────────────
  useEffect(() => {
    if (!hostRef.current) return;

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => { onSaveRef.current?.(); return true; },
      },
      // Mod-Enter also saves — easier to reach on a phone keyboard.
      {
        key: 'Mod-Enter',
        preventDefault: true,
        run: () => { onSaveRef.current?.(); return true; },
      },
    ]);

    const baseExtensions: Extension[] = [
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ activateOnTyping: true, maxRenderedOptions: 40 }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      highlightSpecialChars(),
      highlightTrailingWhitespace(),
      codeFolding(),
      foldGutter(),
      search({ top: false }),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      saveKeymap,
      foxclawEditorTheme,

      compartments.language.of([]),
      compartments.wrap.of(wrap ? EditorView.lineWrapping : []),
      compartments.lineNumbers.of(showLineNumbers ? lineNumbers() : []),
      compartments.readOnly.of([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
      compartments.fontSize.of(
        EditorView.theme({ '.cm-content, .cm-gutters': { fontSize: `${fontSize}px` } })
      ),
      compartments.tabSize.of([
        EditorState.tabSize.of(tabSize),
        indentUnit.of(useTabs ? '\t' : ' '.repeat(tabSize)),
      ]),

      placeholder ? cmPlaceholder(placeholder) : [],

      EditorView.updateListener.of(update => {
        if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) reportCursor(update.view);
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions: baseExtensions }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    reportCursor(view);

    // Load the grammar off the critical path so a large file paints
    // immediately and highlights a beat later.
    let cancelled = false;
    const info = resolveLanguage(fileName);
    setLangReady(!info.load);
    if (info.load) {
      info.load()
        .then((ext: Extension) => {
          if (cancelled || !viewRef.current) return;
          viewRef.current.dispatch({
            effects: compartments.language.reconfigure(ext),
          });
        })
        .catch(() => { /* unknown grammar: plain text is a fine fallback */ })
        .finally(() => { if (!cancelled) setLangReady(true); });
    }

    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
    };
    // Rebuilt only when the document identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // ── Reconfigure on option changes (no teardown) ───────────────────
  const dispatchEffects = (effects: StateEffect<unknown>[]) => {
    viewRef.current?.dispatch({ effects });
  };

  useEffect(() => {
    dispatchEffects([compartments.wrap.reconfigure(wrap ? EditorView.lineWrapping : [])]);
  }, [wrap, compartments]);

  useEffect(() => {
    dispatchEffects([
      compartments.lineNumbers.reconfigure(showLineNumbers ? lineNumbers() : []),
    ]);
  }, [showLineNumbers, compartments]);

  useEffect(() => {
    dispatchEffects([
      compartments.readOnly.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    ]);
  }, [readOnly, compartments]);

  useEffect(() => {
    dispatchEffects([
      compartments.fontSize.reconfigure(
        EditorView.theme({ '.cm-content, .cm-gutters': { fontSize: `${fontSize}px` } })
      ),
    ]);
  }, [fontSize, compartments]);

  useEffect(() => {
    dispatchEffects([
      compartments.tabSize.reconfigure([
        EditorState.tabSize.of(tabSize),
        indentUnit.of(useTabs ? '\t' : ' '.repeat(tabSize)),
      ]),
    ]);
  }, [tabSize, useTabs, compartments]);

  // ── Imperative surface for the toolbar ────────────────────────────
  const run = (fn: (v: EditorView) => void) => {
    const v = viewRef.current;
    if (v) { fn(v); v.focus(); }
  };

  useImperativeHandle(ref, (): CodeEditorHandle => ({
    getValue: () => viewRef.current?.state.doc.toString() ?? '',
    setValue: v => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: v },
      });
    },
    focus: () => viewRef.current?.focus(),
    undo: () => run(v => undo(v)),
    redo: () => run(v => redo(v)),
    selectAll: () => run(v => selectAll(v)),
    indent: () => run(v => indentMore(v)),
    outdent: () => run(v => indentLess(v)),
    toggleComment: () => run(v => toggleComment(v)),
    openSearch: () => run(v => openSearchPanel(v)),
    goToStart: () => run(v => cursorDocStart(v)),
    goToEnd: () => run(v => cursorDocEnd(v)),
    goToLine: line => run(v => {
      const target = Math.max(1, Math.min(line, v.state.doc.lines));
      const pos = v.state.doc.line(target).from;
      v.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      });
    }),
    insert: text => run(v => {
      const sel = v.state.selection.main;
      v.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + text.length },
      });
    }),
    view: () => viewRef.current,
  }), []);

  return (
    <div className={`relative h-full min-h-0 ${className}`}>
      <div ref={hostRef} className="h-full overflow-hidden" />
      {!langReady && (
        <span className="absolute top-2 right-3 text-label text-subtle pointer-events-none">
          loading syntax…
        </span>
      )}
    </div>
  );
});

export default CodeEditor;
