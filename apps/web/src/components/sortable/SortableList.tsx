import {
  createElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { GripVertical } from 'lucide-react';
import { IconButton } from '../IconButton.js';
import { isTextField, keyMove } from './keyMove.js';
import './sortable.css';

/** What a row gets besides its item. */
export interface SortableRow {
  index: number;
  /** The drag handle; null when the list is disabled. */
  handle: ReactNode;
  /** Move this row one place; undefined at the ends of the list and when disabled. */
  moveUp?: () => void;
  moveDown?: () => void;
}

export interface SortableListProps<T> {
  items: readonly T[];
  /** Unique and stable for the life of the draft, and the same while a row is dragged. */
  getId(item: T, index: number): string;
  onMove(from: number, to: number): void;
  /** Read-only lists render their rows without handles and ignore the keyboard. */
  disabled?: boolean;
  /** Names a row for the handle's label and the screen-reader announcements. */
  label(item: T): string;
  /** Memoize it (and `label`) with `useCallback` to let unchanged rows skip rendering. */
  renderItem(item: T, row: SortableRow): ReactNode;
  /** The element around the rows (default `div`) and around each row (default `div`). */
  as?: 'div' | 'ol' | 'ul';
  rowAs?: 'div' | 'li';
  className?: string;
  rowClassName?(item: T, index: number): string | undefined;
}

const INSTRUCTIONS =
  'To reorder, press space or enter on a drag handle, move with the arrow keys, then press space or enter to drop. ' +
  'Alt with the up or down arrow moves the focused row.';

interface RowProps<T> {
  id: string;
  item: T;
  index: number;
  count: number;
  disabled: boolean;
  label(item: T): string;
  renderItem(item: T, row: SortableRow): ReactNode;
  onMove(from: number, to: number): void;
  /** The element to focus again once a keyboard move has been applied. */
  refocus: RefObject<HTMLElement | undefined>;
  as: 'div' | 'li';
  className?: string;
}

function SortableRowView<T>({
  id,
  item,
  index,
  count,
  disabled,
  label,
  renderItem,
  onMove,
  refocus,
  as,
  className,
}: RowProps<T>): ReactNode {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const name = label(item);
  const handle = useMemo(
    () =>
      disabled ? null : (
        <IconButton
          ref={setActivatorNodeRef}
          icon={GripVertical}
          label={`Drag to reorder ${name}`}
          className="sortable-handle"
          {...attributes}
          {...listeners}
        />
      ),
    [disabled, name, attributes, listeners, setActivatorNodeRef],
  );
  const moveUp = useMemo(
    () => (!disabled && index > 0 ? () => onMove(index, index - 1) : undefined),
    [disabled, index, onMove],
  );
  const moveDown = useMemo(
    () => (!disabled && index < count - 1 ? () => onMove(index, index + 1) : undefined),
    [disabled, index, count, onMove],
  );
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Escape cancels a drag in progress; marking it handled keeps the app's own Escape rule from also acting.
    if (isDragging && event.key === 'Escape') return event.preventDefault();
    const target = event.target as HTMLElement;
    const to = disabled || isTextField(target) ? undefined : keyMove(event, index, count);
    if (to === undefined) return;
    event.preventDefault();
    refocus.current = target;
    onMove(index, to);
  };
  return createElement(
    as,
    {
      ref: setNodeRef,
      className: ['sortable-row', isDragging && 'sortable-dragging', className].filter(Boolean).join(' '),
      // Rows only move along the list; no scaling, so a tall open row is not squeezed while another passes it.
      style: { transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition },
      onKeyDown,
    },
    renderItem(item, { index, handle, moveUp, moveDown }),
  );
}

const SortableRowMemo = memo(SortableRowView) as typeof SortableRowView;

/**
 * A vertical list whose rows can be reordered by dragging their handle (mouse, touch, pen), by keyboard (the
 * handle, or Alt+ArrowUp/Down inside a row) and, through `moveUp`/`moveDown`, by buttons the row draws itself.
 * The only file that imports dnd-kit. It never changes `items`: it asks through `onMove`.
 */
export function SortableList<T>({
  items,
  getId,
  onMove,
  disabled = false,
  label,
  renderItem,
  as = 'div',
  rowAs = 'div',
  className,
  rowClassName,
}: SortableListProps<T>) {
  const sensors = useSensors(
    // A click on the handle is not a drag; touch scrolling stays free on the rest of the row.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map(getId);
  // The same array while the ids are the same, so typing in a row does not make every row re-subscribe.
  const idKey = ids.join('\n');
  const stableIds = useMemo(() => ids, [idKey]);
  // A stable move for the rows, whatever closure the caller passes.
  const latest = useRef(onMove);
  latest.current = onMove;
  const move = useCallback((from: number, to: number) => latest.current(from, to), []);
  // A row that moved may lose focus when the browser reorders its element: give it back after the move.
  const refocus = useRef<HTMLElement>(undefined);
  useEffect(() => {
    const element = refocus.current;
    refocus.current = undefined;
    if (element?.isConnected && document.activeElement !== element) element.focus();
  });

  const nameOf = (id: UniqueIdentifier) => {
    const at = stableIds.indexOf(String(id));
    return at === -1 ? 'row' : label(items[at] as T);
  };
  const place = (id: UniqueIdentifier) => `position ${stableIds.indexOf(String(id)) + 1} of ${stableIds.length}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, at ${place(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is over ${place(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)} dropped at ${place(over.id)}.` : `${nameOf(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Cancelled. ${nameOf(active.id)} did not move.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = stableIds.indexOf(String(active.id));
    const to = stableIds.indexOf(String(over.id));
    if (from !== -1 && to !== -1) onMove(from, to);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
    >
      <SortableContext items={stableIds} strategy={verticalListSortingStrategy} disabled={disabled}>
        {createElement(
          as,
          { className },
          items.map((item, index) => (
            <SortableRowMemo
              key={stableIds[index]}
              id={stableIds[index] as string}
              item={item}
              index={index}
              count={items.length}
              disabled={disabled}
              label={label}
              renderItem={renderItem}
              onMove={move}
              refocus={refocus}
              as={rowAs}
              className={rowClassName?.(item, index)}
            />
          )),
        )}
      </SortableContext>
    </DndContext>
  );
}
