import { Watchable, effect, getOwner, onCleanup, root, untrack, type Owner } from '@beacon/core';
import { insert } from 'dom-expressions/src/client.js';
import type { JSX } from 'dom-expressions/src/jsx.js';

// shortcut: every item is the same size; variable sizes need measured offsets, add when a list needs them

/** Indexes [start, end) to render for a scroll offset, with `overscan` extra on each side. */
export function visibleRange(
  offset: number,
  viewport: number,
  itemSize: number,
  count: number,
  overscan: number
): { start: number; end: number } {
  if (itemSize <= 0) {
    throw new Error('itemSize must be positive');
  }
  return {
    start: Math.max(0, Math.floor(offset / itemSize) - overscan),
    end: Math.min(count, Math.ceil((offset + viewport) / itemSize) + overscan),
  };
}

type Slot = {
  readonly el: HTMLElement;
  readonly index: Watchable<number>;
  readonly dispose: () => void;
};

/**
 * Makes `parent`'s children one slot per key, in order. Slots are reused by
 * key, so scrolling moves and creates only the rows that came into view.
 */
function syncSlots<K, S extends Slot>(
  parent: HTMLElement,
  slots: Map<K, S>,
  entries: ReadonlyArray<readonly [key: K, index: number]>,
  create: (key: K, index: number) => S
): Map<K, S> {
  const next = new Map<K, S>();
  for (const [key, index] of entries) {
    if (next.has(key)) {
      continue;
    }
    const slot = slots.get(key) ?? create(key, index);
    slots.delete(key);
    slot.index.set(index);
    const at = parent.children[next.size];
    if (at !== slot.el) {
      parent.insertBefore(slot.el, at ?? null);
    }
    next.set(key, slot);
  }
  for (const slot of slots.values()) {
    slot.dispose();
    slot.el.remove();
  }
  return next;
}

function div(style: Partial<CSSStyleDeclaration>, role: string): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, style);
  el.setAttribute('role', role);
  return el;
}

/** Owned slot: its element, a reactive index, and a root that disposes what it rendered. */
function createSlot(owner: Owner | null, index: number, el: HTMLElement, fill: (index: Watchable<number>) => void): Slot {
  return root((dispose) => {
    const position = Watchable.fromValue(index);
    fill(position);
    return { el, index: position, dispose };
  }, owner);
}

type Scroll = { readonly x: Watchable<number>; readonly y: Watchable<number>; readonly width: Watchable<number>; readonly height: Watchable<number> };

/** Tracks a scroll container's offset and size. Measures after mount, then on scroll and resize. */
function trackScroll(el: HTMLElement): Scroll {
  const scroll: Scroll = {
    x: Watchable.fromValue(0),
    y: Watchable.fromValue(0),
    width: Watchable.fromValue(0),
    height: Watchable.fromValue(0),
  };
  const measure = (): void => {
    scroll.x.set(el.scrollLeft);
    scroll.y.set(el.scrollTop);
    scroll.width.set(el.clientWidth);
    scroll.height.set(el.clientHeight);
  };
  el.addEventListener('scroll', measure, { passive: true });
  const observer = new ResizeObserver(measure);
  observer.observe(el);
  onCleanup(() => observer.disconnect());
  // the element isn't in the document until mount inserts it
  queueMicrotask(measure);
  return scroll;
}

export type VirtualListProps<T> = {
  each: ReadonlyArray<T> | (() => ReadonlyArray<T>);
  /** Pixel size of every item along the scroll axis. */
  itemSize: number;
  axis?: 'vertical' | 'horizontal';
  /** Items rendered beyond each edge, so fast scrolling doesn't show blanks. Default 4. */
  overscan?: number;
  /** Size the list with this class; it scrolls inside whatever box you give it. */
  class?: string;
  children: (item: T, index: () => number) => JSX.Element;
};

/** Renders only the items in view. Rows are keyed by item identity. */
export function VirtualList<T>(props: VirtualListProps<T>): JSX.Element {
  const horizontal = props.axis === 'horizontal';
  const size = props.itemSize;
  const owner = getOwner();

  const viewport = div({ overflow: 'auto', position: 'relative' }, 'list');
  viewport.className = props.class ?? '';
  viewport.tabIndex = 0;
  const content = div({ position: 'relative' }, 'presentation');
  viewport.append(content);
  const scroll = trackScroll(viewport);

  let slots = new Map<T, Slot>();
  onCleanup(() => slots.forEach((slot) => slot.dispose()));

  const createRow = (item: T, index: number): Slot => {
    const el = div(
      horizontal
        ? { position: 'absolute', top: '0', bottom: '0', width: `${size}px` }
        : { position: 'absolute', left: '0', right: '0', height: `${size}px` },
      'listitem'
    );
    return createSlot(owner, index, el, (position) => {
      effect(() => {
        el.style.transform = horizontal ? `translateX(${position() * size}px)` : `translateY(${position() * size}px)`;
        el.setAttribute('aria-posinset', String(position() + 1));
        return undefined;
      }, undefined);
      insert(el, props.children(item, position));
    });
  };

  effect(() => {
    const each = props.each;
    const items = typeof each === 'function' ? each() : each;
    content.style.cssText = horizontal
      ? `position:relative;height:100%;width:${items.length * size}px`
      : `position:relative;height:${items.length * size}px`;
    const { start, end } = horizontal
      ? visibleRange(scroll.x(), scroll.width(), size, items.length, props.overscan ?? 4)
      : visibleRange(scroll.y(), scroll.height(), size, items.length, props.overscan ?? 4);
    untrack(() => {
      const entries = items.slice(start, end).map((item, i) => [item, start + i] as const);
      slots = syncSlots(content, slots, entries, createRow);
      for (const slot of slots.values()) {
        slot.el.setAttribute('aria-setsize', String(items.length));
      }
    });
    return undefined;
  }, undefined);

  return viewport;
}

export type VirtualGridProps = {
  rows: number | (() => number);
  columns: number | (() => number);
  rowSize: number;
  columnSize: number;
  overscan?: number;
  class?: string;
  /** Renders one cell. Cells are created as they scroll into view and disposed as they leave. */
  children: (row: number, column: number) => JSX.Element;
};

type RowSlot = Slot & { cells: Map<number, Slot> };

/** Two-axis virtualization for tables and spreadsheets: only the visible rows × columns exist. */
export function VirtualGrid(props: VirtualGridProps): JSX.Element {
  const owner = getOwner();
  const { rowSize, columnSize } = props;

  const viewport = div({ overflow: 'auto', position: 'relative' }, 'grid');
  viewport.className = props.class ?? '';
  viewport.tabIndex = 0;
  const content = div({ position: 'relative' }, 'presentation');
  viewport.append(content);
  const scroll = trackScroll(viewport);

  let rows = new Map<number, RowSlot>();
  onCleanup(() => rows.forEach((row) => row.dispose()));

  const createCell = (row: number, column: number): Slot => {
    const el = div({ position: 'absolute', top: '0', width: `${columnSize}px`, height: `${rowSize}px` }, 'gridcell');
    el.style.transform = `translateX(${column * columnSize}px)`;
    el.setAttribute('aria-colindex', String(column + 1));
    return createSlot(owner, column, el, () => insert(el, props.children(row, column)));
  };

  const createRow = (row: number): RowSlot => {
    const el = div({ position: 'absolute', left: '0', height: `${rowSize}px` }, 'row');
    el.style.transform = `translateY(${row * rowSize}px)`;
    el.setAttribute('aria-rowindex', String(row + 1));
    const rowSlot: RowSlot = {
      el,
      index: Watchable.fromValue(row),
      cells: new Map(),
      dispose: () => rowSlot.cells.forEach((cell) => cell.dispose()),
    };
    return rowSlot;
  };

  effect(() => {
    const rowCount = typeof props.rows === 'function' ? props.rows() : props.rows;
    const columnCount = typeof props.columns === 'function' ? props.columns() : props.columns;
    content.style.width = `${columnCount * columnSize}px`;
    content.style.height = `${rowCount * rowSize}px`;
    viewport.setAttribute('aria-rowcount', String(rowCount));
    viewport.setAttribute('aria-colcount', String(columnCount));
    const overscan = props.overscan ?? 2;
    const r = visibleRange(scroll.y(), scroll.height(), rowSize, rowCount, overscan);
    const c = visibleRange(scroll.x(), scroll.width(), columnSize, columnCount, overscan);
    untrack(() => {
      const rowEntries = range(r.start, r.end).map((i) => [i, i] as const);
      const columnEntries = range(c.start, c.end).map((i) => [i, i] as const);
      rows = syncSlots(content, rows, rowEntries, createRow);
      for (const [index, row] of rows) {
        row.el.style.width = `${columnCount * columnSize}px`;
        row.cells = syncSlots(row.el, row.cells, columnEntries, (column) => createCell(index, column));
      }
    });
    return undefined;
  }, undefined);

  return viewport;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
}
