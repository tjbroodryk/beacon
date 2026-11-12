// The reactive primitives dom-expressions' runtime imports as "rxcore"; the
// vite plugin aliases that specifier here.
import { untrack } from '@beacon/core';

export { effect, getOwner, memo, root, untrack } from '@beacon/core';

// hydration state; unused until SSR exists
export const sharedConfig: Record<string, unknown> = {};

export function createComponent<P, R>(Comp: (props: P) => R, props: P): R {
  return untrack(() => Comp(props));
}

type Source = Record<string, unknown> | (() => Record<string, unknown> | undefined) | undefined;

/** Merges props objects for spreads, keeping reads lazy so getters stay reactive. */
export function mergeProps(...sources: Source[]): Record<string, unknown> {
  const target: Record<string, unknown> = {};
  for (const source of sources) {
    const resolve = typeof source === 'function' ? source : () => source;
    for (const key of Object.keys(untrack(resolve) ?? {})) {
      Object.defineProperty(target, key, {
        enumerable: true,
        configurable: true,
        get: () => resolve()?.[key],
      });
    }
  }
  return target;
}
