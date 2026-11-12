import { fromValue } from './create-watchable';
import { onCleanup } from './reactive';
import type { ReadonlyWatchable } from './watchable';

// Each follows `source` on its own schedule. They stop when the view or scope
// that created them goes away.

/** Updates once `source` has been quiet for `ms`. For input that triggers requests. */
export function debounced<T>(source: ReadonlyWatchable<T>, ms: number): ReadonlyWatchable<T> {
  const out = fromValue(source.snapshot());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = source.subscribe((value) => {
    clearTimeout(timer);
    timer = setTimeout(() => out.set(value), ms);
  });
  onCleanup(() => {
    unsubscribe();
    clearTimeout(timer);
  });
  return out;
}

/** At most one update per `ms`: the first change at once, then the latest at the end of each window. */
export function throttled<T>(source: ReadonlyWatchable<T>, ms: number): ReadonlyWatchable<T> {
  const out = fromValue(source.snapshot());
  let lastEmit = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { readonly value: T } | null = null;
  const unsubscribe = source.subscribe((value) => {
    const wait = lastEmit + ms - Date.now();
    if (wait <= 0 && timer === undefined) {
      lastEmit = Date.now();
      out.set(value);
      return;
    }
    pending = { value };
    timer ??= setTimeout(() => {
      timer = undefined;
      lastEmit = Date.now();
      if (pending !== null) {
        out.set(pending.value);
        pending = null;
      }
    }, Math.max(wait, 0));
  });
  onCleanup(() => {
    unsubscribe();
    clearTimeout(timer);
  });
  return out;
}

type Cancel = () => void;

const whenIdle: (fn: () => void) => Cancel =
  typeof requestIdleCallback === 'function'
    ? (fn) => {
        const id = requestIdleCallback(fn);
        return () => cancelIdleCallback(id);
      }
    : (fn) => {
        const id = setTimeout(fn, 0);
        return () => clearTimeout(id);
      };

/**
 * Catches up with `source` when the browser is idle; if `source` moves again
 * first, only the latest value is applied. For input that drives heavy local
 * work, so typing stays responsive.
 */
export function deferred<T>(source: ReadonlyWatchable<T>): ReadonlyWatchable<T> {
  const out = fromValue(source.snapshot());
  let cancel: Cancel = () => {};
  const unsubscribe = source.subscribe((value) => {
    cancel();
    cancel = whenIdle(() => out.set(value));
  });
  onCleanup(() => {
    unsubscribe();
    cancel();
  });
  return out;
}
