import { Model, Watchable } from '@beacon/core';
import { afterEach, describe, expect, it } from 'vitest';
import { Async, mount, view } from './index';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let unmount = (): void => {};
afterEach(() => unmount());

describe('<Async>', () => {
  it('makes every state a required prop', () => {
    const user = Watchable.async({ load: async () => 'Ada', whileReloading: 'clear' });
    const missingFailed = (): unknown => (
      // @ts-expect-error a view that reads async data has to say what failure looks like
      <Async of={user} loading={() => <p>loading</p>}>
        {(name) => <h1>{name()}</h1>}
      </Async>
    );
    expect(typeof missingFailed).toBe('function');
    user.dispose();
  });

  it('renders each state, keeps the ready branch across new values, and retries', async () => {
    const requests: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];
    class Profile extends Model {
      readonly name = Watchable.async({
        load: () => new Promise<string>((resolve, reject) => requests.push({ resolve, reject })),
        whileReloading: 'keep',
      });
    }
    const profile = new Profile();
    const App = view([Profile], (p) => (
      <section>
        <Async
          of={p.name}
          loading={() => <p>loading</p>}
          failed={(error, retry, previous) => (
            <button onClick={retry}>
              failed: {String((error as Error).message)} (was {previous ?? 'nothing'})
            </button>
          )}
        >
          {(name, refreshing) => <h1 classList={{ dim: refreshing() }}>{name()}</h1>}
        </Async>
      </section>
    ));
    const el = document.body.appendChild(document.createElement('div'));
    const dispose = mount(App, el, { models: [profile] });
    unmount = () => {
      dispose();
      el.remove();
    };

    expect(el.textContent).toBe('loading');
    requests[0]!.resolve('Ada');
    await flush();
    const h1 = el.querySelector('h1')!;
    expect(h1.textContent).toBe('Ada');

    profile.name.refresh();
    expect(h1.className).toBe('dim');
    requests[1]!.resolve('Grace');
    await flush();
    expect(el.querySelector('h1')).toBe(h1); // same node, new text
    expect([h1.textContent, h1.className]).toEqual(['Grace', '']);

    profile.name.refresh();
    requests[2]!.reject(new Error('offline'));
    await flush();
    expect(el.textContent).toBe('failed: offline (was Grace)');

    el.querySelector('button')!.click();
    requests[3]!.resolve('Ada');
    await flush();
    expect(el.querySelector('h1')!.textContent).toBe('Ada');
  });
});
