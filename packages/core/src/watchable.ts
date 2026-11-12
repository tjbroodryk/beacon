import { computed, effect, signal, untracked } from './signals';

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

// watchables are plain functions, so they can't be told apart from callbacks by shape
const watchables = new WeakSet<object>();

export function isWatchable(value: unknown): value is ReadonlyWatchable<unknown> {
  return typeof value === 'function' && watchables.has(value);
}

function readonly<T>(read: () => T, peek: () => T): ReadonlyWatchable<T> {
  watchables.add(read);
  return Object.assign(read, {
    snapshot: peek,
    subscribe(listener: (value: T) => void): () => void {
      let first = true;
      return effect(() => {
        const value = read();
        if (first) {
          first = false;
          return;
        }
        untracked(() => listener(value));
      });
    },
  });
}

export const Watchable = {
  fromValue<T>(initial: T): Watchable<T> {
    const state = signal(initial);
    return Object.assign(
      readonly(
        () => state.value,
        () => state.peek()
      ),
      {
        set(value: T): void {
          state.value = value;
        },
        update(fn: (prev: T) => T): void {
          state.value = fn(state.peek());
        },
      }
    );
  },

  /** Watchables called inside `fn` become its dependencies. */
  from<T>(fn: () => T): ReadonlyWatchable<T> {
    const derived = computed(fn);
    return readonly(
      () => derived.value,
      () => derived.peek()
    );
  },
};
