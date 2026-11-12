import { effect, isWatchable, onCleanup, type ReadonlyWatchable } from '@beacon/core';
import type { JSX } from '@beacon/dom';
import { createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

/** Each prop as a plain value or a watchable of it; watchables re-render the island when they change. */
export type IslandProps<P> = { [K in keyof P]: P[K] | ReadonlyWatchable<P[K]> };

export type ReactIslandProps<P extends object> = {
  component: ComponentType<P>;
  props: IslandProps<P>;
};

/**
 * Renders a React component inside a beacon view, in its own React root.
 * The wrapper is `display: contents`, so the component lays out as if it
 * were a direct child.
 *
 * shortcut: no beacon children inside the island and no React context across the boundary;
 * wrap providers into the component you pass.
 */
export function ReactIsland<P extends object>(props: ReactIslandProps<P>): JSX.Element {
  const el = document.createElement('div');
  el.style.display = 'contents';
  const root = createRoot(el);

  effect(() => {
    const resolved = Object.fromEntries(
      Object.entries(props.props).map(([key, value]) => [key, isWatchable(value) ? value() : value])
    );
    // every watchable was replaced by its value, which is exactly P
    root.render(createElement(props.component, resolved as P));
    return undefined;
  }, undefined);

  // React won't unmount a root synchronously while it may be rendering; defer to after this tick
  onCleanup(() => queueMicrotask(() => root.unmount()));
  return el;
}
