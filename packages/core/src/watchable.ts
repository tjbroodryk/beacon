import * as api from './watchable-api';

export { isWatchable } from './create-watchable';

/** Call it to read and track; `snapshot()` reads without tracking. */
export type ReadonlyWatchable<T> = {
  (): T;
  snapshot(): T;
  /** Fires on changes after subscribing, not with the current value. */
  subscribe(listener: (value: T) => void): () => void;
};

export type Watchable<T> = ReadonlyWatchable<T> & {
  set(value: T): void;
  update(fn: (prev: T) => T): void;
};

// re-exported as a module namespace, not copied into an object, so bundlers drop unused members
export { api as Watchable };
