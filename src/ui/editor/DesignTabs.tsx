/**
 * Design option tabs ("Option A", "Option B"…) for the active photo:
 * switch, rename (double-click / menu / F2), duplicate (+), new blank option
 * and delete with confirmation.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Copy, Ellipsis, FilePlus2, Pencil, Plus, Trash } from 'lucide-react';
import type { Design, Photo } from '../../../shared/types';
import { useStore } from '../../state/store';
import { ConfirmModal, cn } from '../common';
import { MenuButton } from './Menu';
import { Tooltip } from './Tooltip';

const MAX_NAME = 40;

export function DesignTabs({ photo }: { photo: Photo }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Design | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });
  const active = photo.designs.find((d) => d.id === photo.activeDesignId) ?? photo.designs[0];

  // Fade the edges of the strip when tabs are scrolled out of view (phones).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const max = list.scrollWidth - list.clientWidth;
      setFade((f) => {
        const next = { left: list.scrollLeft > 2, right: list.scrollLeft < max - 2 };
        return f.left === next.left && f.right === next.right ? f : next;
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(list);
    list.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      list.removeEventListener('scroll', update);
    };
  }, [photo.designs.length]);

  // Keep the active tab visible in the strip (without scrolling any ancestor).
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-design-id="${active?.id}"]`);
    if (!list || !el) return;
    const left = el.offsetLeft; // the list is the offsetParent (relative)
    const right = left + el.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = left - 8;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + 8;
  }, [active?.id, photo.designs.length]);

  const select = (id: string) => {
    if (id !== photo.activeDesignId) useStore.getState().setActiveDesign(id);
  };

  const duplicate = () => {
    const s = useStore.getState();
    const id = s.addDesign(undefined, true);
    if (id) s.notify(`Duplicated “${active?.name ?? 'option'}” — changes now go to the new option.`, 'success');
  };

  const addBlank = () => {
    useStore.getState().addDesign(undefined, false);
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const n = photo.designs.length;
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'F2') {
      e.preventDefault();
      setEditing(photo.designs[index].id);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const d = photo.designs[next];
    select(d.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-design-id="${d.id}"]`)?.focus();
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Design options"
        className="scroll-thin relative flex min-w-0 items-center gap-1 overflow-x-auto py-1"
        style={
          fade.left || fade.right
            ? {
                maskImage: `linear-gradient(to right, ${fade.left ? 'transparent, #000 20px' : '#000'}, ${fade.right ? '#000 calc(100% - 20px), transparent' : '#000'})`,
              }
            : undefined
        }
      >
        {photo.designs.map((d, i) =>
          editing === d.id ? (
            <RenameField
              key={d.id}
              design={d}
              onDone={(name) => {
                setEditing(null);
                if (name && name !== d.name) useStore.getState().renameDesign(d.id, name);
              }}
            />
          ) : (
            <button
              key={d.id}
              type="button"
              role="tab"
              data-design-id={d.id}
              aria-selected={d.id === active?.id}
              tabIndex={d.id === active?.id ? 0 : -1}
              title={`${d.name} — double-click to rename`}
              onClick={() => select(d.id)}
              onDoubleClick={() => setEditing(d.id)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={cn(
                'h-8 max-w-[11rem] shrink-0 truncate rounded-lg px-3 text-sm transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                d.id === active?.id ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:bg-surface-2 hover:text-text',
              )}
            >
              {d.name}
            </button>
          ),
        )}
      </div>
      <Tooltip content="Duplicate this option to try a variation">
        <button
          type="button"
          aria-label="Duplicate design option"
          onClick={duplicate}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <Plus className="size-4" />
        </button>
      </Tooltip>
      {active && (
        <MenuButton
          label={`Options for “${active.name}”`}
          align="start"
          items={[
            { label: 'Rename', icon: <Pencil className="size-4" />, hint: 'F2', onSelect: () => setEditing(active.id) },
            { label: 'Duplicate', icon: <Copy className="size-4" />, onSelect: duplicate },
            { label: 'New blank option', icon: <FilePlus2 className="size-4" />, onSelect: addBlank },
            'separator',
            {
              label: 'Delete option',
              icon: <Trash className="size-4" />,
              danger: true,
              disabled: photo.designs.length <= 1,
              hint: photo.designs.length <= 1 ? 'Only option' : undefined,
              onSelect: () => setConfirmDelete(active),
            },
          ]}
        >
          <Ellipsis className="size-4" />
        </MenuButton>
      )}
      <ConfirmModal
        open={!!confirmDelete}
        title="Delete design option?"
        message={
          <>
            “{confirmDelete?.name}” and its finishes, placed plants, objects, lights and AI renders will be removed. The surfaces you
            outlined stay — they are shared by every option of this photo. You can undo this.
          </>
        }
        confirmLabel="Delete option"
        onConfirm={() => {
          if (confirmDelete) useStore.getState().deleteDesign(confirmDelete.id);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function RenameField({ design, onDone }: { design: Design; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(design.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = value.trim().slice(0, MAX_NAME);
    onDone(commit && name ? name : null);
  };

  return (
    <input
      ref={ref}
      value={value}
      maxLength={MAX_NAME}
      aria-label="Design option name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      className="h-8 w-40 shrink-0 rounded-lg border border-accent bg-surface px-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
    />
  );
}
