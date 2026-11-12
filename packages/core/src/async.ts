import { fromValue } from './create-watchable';
import { onCleanup } from './reactive';
import { effect, untracked } from './signals';
import type { ReadonlyWatchable } from './watchable';

/**
 * Every state an async value can be in. There is deliberately no way to read
 * "the value" without first checking which state you're in.
 */
export type AsyncState<T> =
  | { readonly kind: 'loading' }
  /** `refreshing` while a reload runs with `whileReloading: 'keep'`. */
  | { readonly kind: 'ready'; readonly value: T; readonly refreshing: boolean }
  /** `previous` is the last good value under `whileReloading: 'keep'`, otherwise null. */
  | { readonly kind: 'failed'; readonly error: unknown; readonly previous: T | null };

export type AsyncWatchable<T> = {
  readonly state: ReadonlyWatchable<AsyncState<T>>;
  /** Loads again with the current input; also how a failure is retried. */
  refresh(): void;
  /** The next settled value: now if ready and idle, otherwise when the request in flight lands. */
  ready(): Promise<T>;
  /** Aborts the request in flight and stops polling. Runs on its own when created inside a view or scope. */
  dispose(): void;
};

type LoadContext = { readonly signal: AbortSignal };

type Behaviour<T> = {
  /** On reload, keep showing the last value (as refreshing) or go back to loading. */
  whileReloading: 'keep' | 'clear';
  /** Poll: load again this many ms after each response. */
  every?: number;
  /** Stop polling once a value satisfies this. */
  until?: (value: T) => boolean;
};

export type AsyncOptions<T> = Behaviour<T> & {
  /** Pass `signal` on to fetch so superseded requests are cancelled. */
  load: (context: LoadContext) => Promise<T>;
};

export type AsyncInputOptions<I, T> = Behaviour<T> & {
  /** Read reactively: when it changes, the request in flight is aborted and a new one starts. */
  input: () => I;
  /** Not tracked. Pass `signal` on to fetch so superseded requests are cancelled. */
  load: (input: I, context: LoadContext) => Promise<T>;
};

type Waiter<T> = { resolve: (value: T) => void; reject: (error: unknown) => void };

export function asyncWatchable<I, T>(options: AsyncInputOptions<I, T>): AsyncWatchable<T>;
export function asyncWatchable<T>(options: AsyncOptions<T>): AsyncWatchable<T>;
export function asyncWatchable<I, T>(options: AsyncOptions<T> | AsyncInputOptions<I, T>): AsyncWatchable<T> {
  if ('input' in options) {
    return create(options.input, options.load, options);
  }
  return create(
    () => undefined,
    (_, context) => options.load(context),
    options
  );
}

function create<I, T>(
  readInput: () => I,
  load: (input: I, context: LoadContext) => Promise<T>,
  options: Behaviour<T>
): AsyncWatchable<T> {
  const state = fromValue<AsyncState<T>>({ kind: 'loading' });
  const keep = options.whileReloading === 'keep';
  let last: { readonly value: T } | null = null;
  let input: { readonly value: I } | null = null;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let disposed = false;
  let waiters: Array<Waiter<T>> = [];

  const settle = (fn: (waiter: Waiter<T>) => void): void => {
    const pending = waiters;
    waiters = [];
    pending.forEach(fn);
  };

  const poll = (value: T | null): void => {
    if (options.every === undefined || disposed) {
      return;
    }
    if (value !== null && options.until?.(value) === true) {
      return;
    }
    timer = setTimeout(() => run(), options.every);
  };

  const run = (): void => {
    if (disposed || input === null) {
      return;
    }
    controller?.abort();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const mine = ++generation;
    const own = new AbortController();
    controller = own;
    if (keep && last !== null) {
      state.set({ kind: 'ready', value: last.value, refreshing: true });
    } else if (state.snapshot().kind !== 'loading') {
      // already loading: a new input mustn't look like a new state to whoever's showing a spinner
      state.set({ kind: 'loading' });
    }

    let request: Promise<T>;
    try {
      request = load(input.value, { signal: own.signal });
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then(
      (value) => {
        // a newer request owns the state now; this response is stale
        if (mine !== generation || disposed) {
          return;
        }
        controller = null;
        last = { value };
        state.set({ kind: 'ready', value, refreshing: false });
        settle((w) => w.resolve(value));
        poll(value);
      },
      (error: unknown) => {
        if (mine !== generation || disposed) {
          return;
        }
        controller = null;
        state.set({ kind: 'failed', error, previous: keep && last !== null ? last.value : null });
        settle((w) => w.reject(error));
        poll(null);
      }
    );
  };

  const stopInput = effect(() => {
    input = { value: readInput() };
    untracked(run);
  });

  const self: AsyncWatchable<T> = {
    state,
    refresh: run,
    ready(): Promise<T> {
      const current = state.snapshot();
      if (current.kind === 'ready' && !current.refreshing) {
        return Promise.resolve(current.value);
      }
      if (current.kind === 'failed' && controller === null) {
        return Promise.reject(current.error);
      }
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      stopInput();
      controller?.abort();
      if (timer !== null) {
        clearTimeout(timer);
      }
      settle((w) => w.reject(new Error('async watchable disposed')));
    },
  };
  onCleanup(self.dispose);
  return self;
}
