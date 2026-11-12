import { Model, Watchable } from '@beacon/core';
import { mount, view } from '@beacon/dom';
import { createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReactIsland } from './index';

// written with createElement: this file's JSX compiles to beacon, not React
function Counter(props: { label: string; start: number; onCommit: (n: number) => void }) {
  const [n, setN] = useState(props.start);
  return createElement(
    'button',
    { onClick: () => (setN(n + 1), props.onCommit(n + 1)) },
    `${props.label}: ${n}`
  );
}

class Settings extends Model {
  readonly label = Watchable.fromValue('count');
  readonly committed = Watchable.fromValue(0);
}

describe('ReactIsland', () => {
  it('renders a React component with watchable props, both ways, and unmounts it', async () => {
    const settings = new Settings();
    const App = view([Settings], (s) => (
      <section>
        <ReactIsland
          component={Counter}
          props={{ label: s.label, start: 5, onCommit: (n: number) => s.committed.set(n) }}
        />
      </section>
    ));
    const el = document.body.appendChild(document.createElement('div'));
    const unmount = mount(App, el, { models: [settings] });

    const button = await vi.waitFor(() => {
      const found = el.querySelector('button');
      if (found === null) {
        throw new Error('React has not rendered yet');
      }
      return found;
    });
    expect(button.textContent).toBe('count: 5');

    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe('count: 6'));
    expect(settings.committed.snapshot()).toBe(6);

    // a watchable prop changing re-renders the island, keeping its React state
    settings.label.set('clicks');
    await vi.waitFor(() => expect(button.textContent).toBe('clicks: 6'));

    unmount();
    await vi.waitFor(() => expect(el.querySelector('button')).toBeNull());
    el.remove();
  });
});
