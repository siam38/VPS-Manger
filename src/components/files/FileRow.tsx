import React from 'react';
import { Check, Folder as FolderIcon, MoreHorizontal } from 'lucide-react';
import { getFileIcon, formatBytes, formatDate } from '../../lib/utils';
import { classifyFile } from '../../lib/fileTypes';

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  permissions: string;
}

interface RowProps {
  item: FileItem;
  selected: boolean;
  cut: boolean;
  view: 'list' | 'grid';
  onOpen: (item: FileItem) => void;
  onToggle: (item: FileItem, e: React.MouseEvent | React.ChangeEvent) => void;
  onMenu: (item: FileItem, x: number, y: number) => void;
}

/**
 * One entry. Split out of the page so the list can be memoised — the old
 * version re-rendered all 800 rows on every keystroke in the search box.
 */
export const FileRow = React.memo(function FileRow({
  item, selected, cut, view, onOpen, onToggle, onMenu,
}: RowProps) {
  const { Icon, color } = getFileIcon(item.name, item.isDirectory);
  const kind = item.isDirectory ? 'folder' : classifyFile(item.name);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onMenu(item, e.clientX, e.clientY);
  };

  if (view === 'grid') {
    return (
      <button
        type="button"
        onClick={() => onOpen(item)}
        onContextMenu={openMenu}
        aria-label={`${item.isDirectory ? 'Folder' : 'File'} ${item.name}`}
        className={`group relative flex flex-col items-center gap-2 p-3 rounded-card border
                    transition-colors text-center
                    ${selected
                      ? 'border-accent/50 bg-accent/10'
                      : 'border-transparent hover:border-line hover:bg-surface'}
                    ${cut ? 'opacity-50' : ''}`}
      >
        <span
          role="checkbox"
          aria-checked={selected}
          tabIndex={-1}
          onClick={e => { e.stopPropagation(); onToggle(item, e); }}
          className={`absolute top-1.5 left-1.5 w-5 h-5 rounded border flex items-center justify-center
                      transition-opacity
                      ${selected
                        ? 'bg-accent border-accent opacity-100'
                        : 'border-line-strong bg-canvas opacity-0 group-hover:opacity-100 max-md:opacity-100'}`}
        >
          {selected && <Check className="w-3 h-3 text-canvas" aria-hidden="true" />}
        </span>

        <Icon className={`w-9 h-9 ${item.isDirectory ? 'text-accent' : color}`} aria-hidden="true" />
        <span className="text-meta text-ink w-full truncate" title={item.name}>{item.name}</span>
        <span className="text-label text-muted tabular">
          {item.isDirectory ? '—' : formatBytes(item.size)}
        </span>
      </button>
    );
  }

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item); }
      }}
      onContextMenu={openMenu}
      aria-label={`${item.isDirectory ? 'Folder' : 'File'} ${item.name}`}
      className={`group grid items-center gap-3 px-2 sm:px-3 h-9 max-md:h-11
                  cursor-pointer transition-colors relative
                  grid-cols-[24px_1fr_auto_auto_32px]
                  ${selected
                    ? 'bg-accent/[0.12] text-ink'
                    : 'hover:bg-white/[0.04]'}
                  ${cut ? 'opacity-45' : ''}`}
    >
      {/* Selected rows get an edge bar rather than a border box. */}
      {selected && (
        <span className="absolute left-0 top-0 h-full w-0.5 bg-accent" aria-hidden="true" />
      )}

      <span
        role="checkbox"
        aria-checked={selected}
        tabIndex={-1}
        onClick={e => { e.stopPropagation(); onToggle(item, e); }}
        className={`w-4 h-4 rounded-chip border flex items-center justify-center transition-colors mx-auto
                    ${selected
                      ? 'bg-accent border-accent'
                      : 'border-line-strong hover:border-accent opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:opacity-100'}`}
      >
        {selected && <Check className="w-3 h-3 text-canvas" aria-hidden="true" />}
      </span>

      <span className="flex items-center gap-2 min-w-0">
        <Icon
          strokeWidth={1.5}
          className={`w-4 h-4 shrink-0 ${item.isDirectory ? 'text-accent' : 'text-muted/70'}`}
          aria-hidden="true"
        />
        <span className="text-body text-ink truncate">{item.name}</span>
      </span>

      {/* Machine data: mono, tabular, right-aligned so columns actually line up. */}
      <span className="text-meta text-muted font-mono tabular text-right w-20 hidden sm:block">
        {item.isDirectory ? '—' : formatBytes(item.size)}
      </span>

      <span className="text-meta text-muted font-mono tabular text-right w-28 hidden lg:block">
        {formatDate(item.modified)}
      </span>

      <button
        type="button"
        onClick={openMenu}
        aria-label={`Actions for ${item.name}`}
        className="w-7 h-7 rounded-control flex items-center justify-center
                   text-muted hover:text-ink hover:bg-raised transition-colors
                   md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
      >
        <MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
});

export function EmptyState({ searching, onNewFile, onNewFolder, onUpload }: {
  searching: boolean;
  onNewFile: () => void;
  onNewFolder: () => void;
  onUpload: () => void;
}) {
  return (
    <div className="empty h-full justify-center">
      <FolderIcon className="w-10 h-10 text-subtle mb-2" aria-hidden="true" />
      <p className="empty-title">{searching ? 'No matches' : 'This folder is empty'}</p>
      <p className="empty-sub">
        {searching
          ? 'Nothing here matches your filter. Try a shorter term.'
          : 'Create a file or folder here, or upload something from your device.'}
      </p>
      {!searching && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
          <button className="btn btn-primary" onClick={onNewFile}>New file</button>
          <button className="btn btn-quiet" onClick={onNewFolder}>New folder</button>
          <button className="btn btn-quiet" onClick={onUpload}>Upload</button>
        </div>
      )}
    </div>
  );
}
