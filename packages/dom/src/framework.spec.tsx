import { Action, Model, Watchable, type ModelScope } from '@beacon/core';
import { afterEach, describe, expect, it } from 'vitest';
import { For, Scope, mount, useAction, view, type Component, type MountOptions } from './index';

class Counter extends Model {
  readonly count = Watchable.fromValue(0);
}

class Increment extends Action {
  readonly title = 'Increment';
  override applicable(scope: ModelScope): boolean {
    return scope.get(Counter).count() < 2;
  }
  execute(_: void, scope: ModelScope): void {
    scope.get(Counter).count.update((c) => c + 1);
  }
}

let unmount = (): void => {};
afterEach(() => unmount());

function render(App: Component, options: MountOptions): HTMLElement {
  // events are delegated to document, so the root has to be attached
  const el = document.body.appendChild(document.createElement('div'));
  const dispose = mount(App, el, options);
  unmount = () => {
    dispose();
    el.remove();
  };
  return el;
}

describe('views', () => {
  it('binds watchables to text and attributes without re-running the view', async () => {
    let viewRuns = 0;
    const CounterView = view([Counter], (counter) => {
      viewRuns++;
      const inc = useAction(Increment);
      return (
        <button disabled={!inc.applicable()} onClick={() => inc.execute()}>
          {counter.count() > 0 ? `clicked ${counter.count()}` : 'never clicked'}
        </button>
      );
    });

    const el = render(CounterView, { models: [Counter], actions: [Increment] });
    const button = el.querySelector('button')!;
    expect(button.textContent).toBe('never clicked');

    button.click();
    await Promise.resolve();
    button.click();
    await Promise.resolve();

    expect(button.textContent).toBe('clicked 2');
    expect(button.disabled).toBe(true);
    expect(viewRuns).toBe(1);
  });

  it('nests scopes, and disposes their models on unmount', () => {
    let disposed = 0;
    class Page extends Model {
      readonly title = 'page';
      override dispose(): void {
        disposed++;
      }
    }
    const Title = view([Page, Counter], (page, counter) => (
      <h1>
        {page.title} {counter.count()}
      </h1>
    ));
    const App: Component = () => (
      <Scope models={[new Page()]}>
        <Title />
      </Scope>
    );

    const el = render(App, { models: [Counter] });
    expect(el.textContent).toBe('page 0');
    unmount();
    expect(disposed).toBe(1);
  });

  it('keeps list rows (and their DOM nodes) across reorders', () => {
    class List extends Model {
      readonly items = Watchable.fromValue(['a', 'b', 'c']);
    }
    const Items = view([List], (list) => (
      <ul>
        <For each={list.items}>{(item) => <li>{item}</li>}</For>
      </ul>
    ));
    const list = new List();
    const el = render(Items, { models: [list] });
    const a = el.querySelector('li');
    expect(el.textContent).toBe('abc');

    list.items.set(['c', 'a']);
    expect(el.textContent).toBe('ca');
    expect(el.querySelectorAll('li')[1]).toBe(a);
  });

  it('names the missing model and what is in scope', () => {
    const Lonely = view([Counter], (counter) => <p>{counter.count()}</p>);
    expect(() => render(Lonely, {})).toThrow('No Counter in scope (in scope: [])');
  });
});
