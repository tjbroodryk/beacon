import type { AsyncState, AsyncWatchable } from '@beacon/core';
import { memo, untrack } from '@beacon/core/internal';
import type { JSX } from 'dom-expressions/src/jsx.js';

type Ready<T> = Extract<AsyncState<T>, { kind: 'ready' }>;

export type AsyncProps<T> = {
  of: AsyncWatchable<T>;
  /** No value yet. */
  loading: () => JSX.Element;
  /** `previous` is the last good value when the watchable keeps it, otherwise null. */
  failed: (error: unknown, retry: () => void, previous: T | null) => JSX.Element;
  /** Built once per stretch of readiness; `value()` and `refreshing()` update in place. */
  children: (value: () => T, refreshing: () => boolean) => JSX.Element;
};

/**
 * The way to get a value out of an async watchable in a view. All three states
 * are required props, so forgetting the failure case is a type error, not a
 * blank screen.
 */
export function Async<T>(props: AsyncProps<T>): JSX.Element {
  const state = props.of.state;
  // the latest ready state, held through other states so a branch being torn down never reads a missing value
  const latest = memo<Ready<T> | null>((prev) => {
    const current = state();
    return current.kind === 'ready' ? current : (prev ?? null);
  });
  const value = (): T => {
    const ready = latest();
    if (ready === null) {
      throw new Error('Async: read a value before the first ready state');
    }
    return ready.value;
  };
  const refreshing = (): boolean => latest()?.refreshing ?? false;
  // rebuild on a change of branch, or a new failure; not on every new value
  const branch = memo<'ready' | AsyncState<T>>(() => {
    const current = state();
    return current.kind === 'ready' ? 'ready' : current;
  });

  const render = (): JSX.Element => {
    const current = branch();
    return untrack(() => {
      if (current === 'ready') {
        return props.children(value, refreshing);
      }
      if (current.kind === 'failed') {
        return props.failed(current.error, () => props.of.refresh(), current.previous);
      }
      return props.loading();
    });
  };
  // insert() takes accessors but JSX.Element doesn't model them; Solid's control flow makes the same cast
  return render as unknown as JSX.Element;
}
