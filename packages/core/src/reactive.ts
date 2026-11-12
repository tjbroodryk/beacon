import {
  batch,
  effect as signalEffect,
  signal,
  untracked,
  type Signal,
} from '@preact/signals-core';

export { batch };

/**
 * Owns the cleanups of everything created while it is current: effects,
 * nested owners, scopes. Disposing an owner disposes its whole subtree, which
 * is what stops a removed view's bindings from leaking subscriptions.
 */
export class Owner {
  readonly cleanups: Array<() => void> = [];

  constructor(
    readonly parent: Owner | null,
    readonly context: ReadonlyMap<ContextKey<unknown>, unknown>
  ) {}

  dispose(): void {
    const cleanups = this.cleanups.splice(0).reverse();
    untracked(() => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    });
  }
}

export class ContextKey<T> {
  declare readonly _type: T;
  constructor(readonly name: string) {}
}

const emptyContext: ReadonlyMap<ContextKey<unknown>, unknown> = new Map();
let currentOwner: Owner | null = null;

export function getOwner(): Owner | null {
  return currentOwner;
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const previous = currentOwner;
  currentOwner = owner;
  try {
    return fn();
  } finally {
    currentOwner = previous;
  }
}

export function onCleanup(fn: () => void): void {
  currentOwner?.cleanups.push(fn);
}

export function untrack<T>(fn: () => T): T {
  return untracked(fn);
}

/** A detached owner: nothing disposes it but the `dispose` it is handed. */
export function root<T>(fn: (dispose: () => void) => T, parent: Owner | null = currentOwner): T {
  const owner = new Owner(parent, parent?.context ?? emptyContext);
  return runWithOwner(owner, () => untracked(() => fn(() => owner.dispose())));
}

/**
 * Re-runs `fn` when what it read changes. Everything `fn` created on its last
 * run is disposed first, so a branch that swaps out takes its bindings with it.
 */
export function effect<T>(fn: (prev: T) => T, initial: T): void {
  const owner = new Owner(currentOwner, currentOwner?.context ?? emptyContext);
  let value = initial;
  const stop = signalEffect(() => {
    owner.dispose();
    value = runWithOwner(owner, () => fn(value));
  });
  onCleanup(() => {
    stop();
    owner.dispose();
  });
}

/** An owned, cached derivation; unlike `computed`, what it creates is disposed on re-run. */
export function memo<T>(fn: (prev: T | undefined) => T): () => T {
  let out: Signal<T> | undefined;
  effect<T | undefined>((prev) => {
    const next = fn(prev);
    if (out === undefined) {
      out = signal(next);
    } else {
      out.value = next;
    }
    return next;
  }, undefined);
  const created = out;
  if (created === undefined) {
    throw new Error('memo: effect did not run synchronously');
  }
  return () => created.value;
}

/** Runs `fn` under a child owner that sees `values` on top of the inherited context. */
export function provideContext<T>(
  values: ReadonlyArray<readonly [ContextKey<unknown>, unknown]>,
  fn: () => T
): T {
  const context = new Map(currentOwner?.context ?? emptyContext);
  for (const [key, value] of values) {
    context.set(key, value);
  }
  const owner = new Owner(currentOwner, context);
  onCleanup(() => owner.dispose());
  return runWithOwner(owner, fn);
}

export function readContext<T>(key: ContextKey<T>): T | undefined {
  // the map is heterogeneous; provideContext is the only writer and keys carry their type
  return currentOwner?.context.get(key) as T | undefined;
}
