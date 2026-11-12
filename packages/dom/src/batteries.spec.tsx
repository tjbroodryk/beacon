import { Action, Model, Watchable, type ModelScope } from '@beacon/core';
import { onCleanup } from '@beacon/core/internal';
import { afterEach, describe, expect, it } from 'vitest';
import {
  For,
  Scope,
  VirtualGrid,
  VirtualList,
  mount,
  useActions,
  view,
  visibleRange,
  type Component,
  type MountOptions,
} from './index';
import { parseShortcut } from './shortcuts';

let unmount = (): void => {};
afterEach(() => unmount());

function render(App: Component, options: MountOptions): HTMLElement {
  const el = document.body.appendChild(document.createElement('div'));
  const dispose = mount(App, el, options);
  unmount = () => {
    dispose();
    el.remove();
  };
  return el;
}

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

class Item extends Model {
  constructor(readonly name: string) {
    super();
  }
}

class Items extends Model {
  readonly all = Watchable.fromValue([new Item('a'), new Item('b')]);
  readonly log = Watchable.fromValue<string[]>([]);
}

class Remove extends Action {
  readonly title = 'Remove';
  override readonly shortcut = 'backspace';
  override applicable(scope: ModelScope): boolean {
    return scope.has(Item);
  }
  execute(_: void, scope: ModelScope): void {
    const item = scope.get(Item);
    scope.get(Items).all.update((all) => all.filter((i) => i !== item));
  }
}

class Save extends Action {
  readonly title = 'Save';
  override readonly shortcut = 'ctrl+s';
  execute(_: void, scope: ModelScope): void {
    scope.get(Items).log.update((log) => [...log, 'saved']);
  }
}

describe('shortcuts', () => {
  const Row = view([Item], (item) => (
    <li>
      <button>{item.name}</button>
    </li>
  ));
  const List = view([Items], (items) => (
    <ul>
      <For each={items.all}>
        {(item) => (
          <Scope models={[item]}>
            <Row />
          </Scope>
        )}
      </For>
      <input aria-label="name" />
    </ul>
  ));

  it('runs an action in the scope of the focused element', () => {
    const items = new Items();
    const el = render(List, { models: [items], actions: [Remove, Save] });

    const second = el.querySelectorAll('button')[1]!;
    const event = press(second, { key: 'Backspace', code: 'Backspace' });

    expect(event.defaultPrevented).toBe(true);
    expect(items.all.snapshot().map((i) => i.name)).toEqual(['a']);
  });

  it('leaves the key to the browser where no action applies, and while typing', () => {
    const items = new Items();
    const el = render(List, { models: [items], actions: [Remove, Save] });

    expect(press(document.body, { key: 'Backspace' }).defaultPrevented).toBe(false);
    expect(press(el.querySelector('input')!, { key: 'Backspace' }).defaultPrevented).toBe(false);
    expect(items.all.snapshot()).toHaveLength(2);

    // modified shortcuts still work from inside a text field
    expect(press(el.querySelector('input')!, { key: 's', code: 'KeyS', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(items.log.snapshot()).toEqual(['saved']);
  });

  it('lists the actions that apply in a scope, live, with no applicable() meaning always', () => {
    const items = new Items();
    let titles: string[] = [];
    const Probe = view([Items], () => {
      const actions = useActions();
      return <p>{(titles = actions.applicable().map((a) => a.title)).join(',')}</p>;
    });
    const RowProbe = view([Item], () => {
      const actions = useActions();
      return <p>{actions.applicable().map((a) => a.title).join(',')}</p>;
    });
    const el = render(
      () => (
        <div>
          <Probe />
          <Scope models={[items.all.snapshot()[0]!]}>
            <RowProbe />
          </Scope>
        </div>
      ),
      { models: [items], actions: [Remove, Save] }
    );
    expect(titles).toEqual(['Save']);
    expect(el.querySelectorAll('p')[1]!.textContent).toBe('Remove,Save');
  });

  it('rejects malformed shortcuts', () => {
    expect(() => parseShortcut('ctrl+')).toThrow('has no key');
    expect(() => parseShortcut('hyper+k')).toThrow('unknown modifier "hyper"');
  });
});

function sized(el: HTMLElement, box: { width?: number; height?: number }): void {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: box.width ?? 0 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: box.height ?? 0 });
}

function scrollTo(el: HTMLElement, at: { top?: number; left?: number }): void {
  Object.defineProperty(el, 'scrollTop', { configurable: true, value: at.top ?? 0 });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, value: at.left ?? 0 });
  el.dispatchEvent(new Event('scroll'));
}

describe('visibleRange', () => {
  it('covers the viewport plus overscan, clamped to the list', () => {
    expect(visibleRange(0, 100, 10, 1000, 4)).toEqual({ start: 0, end: 14 });
    expect(visibleRange(500, 100, 10, 1000, 4)).toEqual({ start: 46, end: 64 });
    expect(visibleRange(9_990, 100, 10, 1000, 4)).toEqual({ start: 995, end: 1000 });
  });
});

describe('VirtualList', () => {
  class Numbers extends Model {
    readonly all = Watchable.fromValue(Array.from({ length: 1000 }, (_, i) => i));
  }

  it('renders only what is in view, and reuses rows that stay in view', async () => {
    const Numbered = view([Numbers], (numbers) => (
      <VirtualList each={numbers.all} itemSize={10}>
        {(n) => <span>item {n}</span>}
      </VirtualList>
    ));
    const el = render(Numbered, { models: [new Numbers()] });
    const list = el.querySelector<HTMLElement>('[role=list]')!;
    sized(list, { height: 100 });
    await Promise.resolve();

    const rows = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('[role=listitem]')];
    expect(rows()).toHaveLength(14);
    const row9 = rows()[9];

    scrollTo(list, { top: 50 });
    expect(rows()[0]!.textContent).toBe('item 1');
    expect(rows()).toContain(row9);
    expect(rows()[0]!.style.transform).toBe('translateY(10px)');
    expect(rows()[0]!.getAttribute('aria-setsize')).toBe('1000');
  });

  it('scrolls horizontally', async () => {
    const Strip = view([Numbers], (numbers) => (
      <VirtualList each={numbers.all} itemSize={20} axis="horizontal">
        {(n) => <span>{n}</span>}
      </VirtualList>
    ));
    const el = render(Strip, { models: [new Numbers()] });
    const list = el.querySelector<HTMLElement>('[role=list]')!;
    sized(list, { width: 100 });
    await Promise.resolve();
    scrollTo(list, { left: 200 });

    const first = list.querySelector<HTMLElement>('[role=listitem]')!;
    expect(first.textContent).toBe('6');
    expect(first.style.transform).toBe('translateX(120px)');
  });
});

describe('VirtualGrid', () => {
  it('renders the visible rows × columns and disposes cells that leave', async () => {
    let live = 0;
    const Grid: Component = () => (
      <VirtualGrid rows={1000} columns={1000} rowSize={10} columnSize={10}>
        {(r, c) => {
          live++;
          onCleanup(() => live--);
          return `${r},${c}`;
        }}
      </VirtualGrid>
    );
    const el = render(Grid, {});
    const grid = el.querySelector<HTMLElement>('[role=grid]')!;
    sized(grid, { width: 30, height: 50 });
    await Promise.resolve();

    // 5 rows + 2 overscan, 3 columns + 2 overscan
    expect(grid.querySelectorAll('[role=row]')).toHaveLength(7);
    expect(grid.querySelectorAll('[role=gridcell]')).toHaveLength(35);
    expect(live).toBe(35);

    scrollTo(grid, { top: 5000, left: 5000 });
    const firstCell = grid.querySelector('[role=gridcell]')!;
    expect(firstCell.textContent).toBe('498,498');
    expect(live).toBe(grid.querySelectorAll('[role=gridcell]').length);

    unmount();
    expect(live).toBe(0);
  });
});
