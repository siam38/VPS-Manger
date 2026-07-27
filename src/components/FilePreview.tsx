import React, { useEffect, useRef, useState } from 'react';
import {
  Download, FileArchive, FileText, Maximize2, Minus, Plus,
  RotateCw, X, ZoomIn,
} from 'lucide-react';
import { fetchBlobUrl } from '../lib/api';
import { classifyFile, KIND_LABEL, type FileKind } from '../lib/fileTypes';
import { formatBytes } from '../lib/utils';

interface Props {
  path: string;
  name: string;
  size: number;
  onClose: () => void;
  onDownload: () => void;
}

/**
 * Inline previewer.
 *
 * Replaces four `alert("... coming soon")` stubs. Images, audio, video and PDF
 * now actually render; archives and office documents get an honest panel that
 * says what they are and offers the download, instead of pretending a feature
 * exists.
 */
export default function FilePreview({ path, name, size, onClose, onDownload }: Props) {
  const kind: FileKind = classifyFile(name);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const urlRef = useRef<string | null>(null);

  const needsBlob = kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'pdf';

  useEffect(() => {
    if (!needsBlob) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchBlobUrl(path)
      .then(({ url: u }) => {
        if (cancelled) { URL.revokeObjectURL(u); return; }
        urlRef.current = u;
        setUrl(u);
      })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not load file'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
  }, [path, needsBlob]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col bg-canvas/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${name}`}
    >
      {/* Header */}
      <header className="flex items-center gap-2 px-3 sm:px-4 h-14 border-b border-line bg-surface/80 shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-ink truncate">{name}</p>
          <p className="text-label text-muted">
            {KIND_LABEL[kind]} · {formatBytes(size)}
          </p>
        </div>

        {kind === 'image' && url && (
          <div className="hidden sm:flex items-center gap-1 mr-1">
            <button className="btn-icon" onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} aria-label="Zoom out">
              <Minus className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="text-meta text-muted tabular w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button className="btn-icon" onClick={() => setZoom(z => Math.min(8, z + 0.25))} aria-label="Zoom in">
              <Plus className="w-4 h-4" aria-hidden="true" />
            </button>
            <button className="btn-icon" onClick={() => { setZoom(1); setRotation(0); }} aria-label="Reset view">
              <Maximize2 className="w-4 h-4" aria-hidden="true" />
            </button>
            <button className="btn-icon" onClick={() => setRotation(r => (r + 90) % 360)} aria-label="Rotate image">
              <RotateCw className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <button className="btn btn-quiet btn-sm" onClick={onDownload}>
          <Download className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Download</span>
        </button>
        <button className="btn-icon" onClick={onClose} aria-label="Close preview">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4">
        {loading && (
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        )}

        {!loading && error && (
          <div className="empty">
            <FileText className="w-10 h-10 text-subtle mb-2" aria-hidden="true" />
            <p className="empty-title">Preview unavailable</p>
            <p className="empty-sub">{error}</p>
            <button className="btn btn-quiet mt-3" onClick={onDownload}>
              <Download className="w-4 h-4" aria-hidden="true" /> Download instead
            </button>
          </div>
        )}

        {!loading && !error && kind === 'image' && url && (
          <img
            src={url}
            alt={name}
            className="max-w-full origin-center transition-transform duration-150"
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
            onDoubleClick={() => setZoom(z => (z === 1 ? 2 : 1))}
          />
        )}

        {!loading && !error && kind === 'audio' && url && (
          <div className="w-full max-w-lg card p-5">
            <p className="text-body text-ink truncate mb-3">{name}</p>
            <audio src={url} controls autoPlay className="w-full" />
          </div>
        )}

        {!loading && !error && kind === 'video' && url && (
          <video src={url} controls autoPlay className="max-w-full max-h-full rounded-card" />
        )}

        {!loading && !error && kind === 'pdf' && url && (
          <iframe src={url} title={name} className="w-full h-full rounded-card bg-white" />
        )}

        {!loading && (kind === 'archive' || kind === 'document' || kind === 'binary') && (
          <div className="empty">
            {kind === 'archive'
              ? <FileArchive className="w-10 h-10 text-subtle mb-2" aria-hidden="true" />
              : <FileText className="w-10 h-10 text-subtle mb-2" aria-hidden="true" />}
            <p className="empty-title">
              {kind === 'archive' ? 'Archive file' : kind === 'document' ? 'Office document' : 'Binary file'}
            </p>
            <p className="empty-sub">
              {kind === 'archive'
                ? 'Archives cannot be expanded in the browser. Download it, or extract it from the terminal.'
                : kind === 'document'
                  ? 'This format needs a desktop application. Download it to open.'
                  : 'This file is not text and has no browser preview.'}
            </p>
            <button className="btn btn-primary mt-3" onClick={onDownload}>
              <Download className="w-4 h-4" aria-hidden="true" /> Download
            </button>
          </div>
        )}
      </div>

      {/* Mobile zoom controls, thumb-reachable */}
      {kind === 'image' && url && (
        <div className="sm:hidden flex items-center justify-center gap-2 h-14 border-t border-line bg-surface/80 shrink-0">
          <button className="btn-icon" onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} aria-label="Zoom out">
            <Minus className="w-4 h-4" aria-hidden="true" />
          </button>
          <span className="text-meta text-muted tabular w-14 text-center">{Math.round(zoom * 100)}%</span>
          <button className="btn-icon" onClick={() => setZoom(z => Math.min(8, z + 0.25))} aria-label="Zoom in">
            <Plus className="w-4 h-4" aria-hidden="true" />
          </button>
          <button className="btn-icon" onClick={() => { setZoom(1); setRotation(0); }} aria-label="Reset view">
            <ZoomIn className="w-4 h-4" aria-hidden="true" />
          </button>
          <button className="btn-icon" onClick={() => setRotation(r => (r + 90) % 360)} aria-label="Rotate image">
            <RotateCw className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
