/**
 * The reactive engine under watchables: signals, computeds, effects.
 *
 * Push-pull. A write pushes a "maybe stale" mark down to dependants and
 * queues the effects it reaches; nothing recomputes until it's read. A read
 * pulls: it re-checks each source's version and recomputes only if one moved.
 * So a computed that recomputes to an equal value stops the update there, and
 * a diamond (a → b, a → c, b + c → d) runs d once, never with half-updated
 * inputs.
 *
 * A computed is linked into its sources' observer sets only while something
 * observes it. Unobserved, it holds no links and verifies by version on every
 * read, which is what lets a disposed view's computeds be garbage collected.
 */

const CLEAN = 0;
const STALE = 1;

type Tracking = { sources: Source[]; versions: number[]; seen: Set<Source> };

let tracking: Tracking | null = null;
let batchDepth = 0;
let flushing = false;
const queue: Effect[] = [];

abstract class Source {
  /** Bumped whenever the value changes; readers compare it to what they last saw. */
  version = 0;
  readonly observers = new Set<Derived>();

  /** Brings the value up to date. */
  abstract refresh(): void;

  protected track(): void {
    this.refresh();
    if (tracking !== null && !tracking.seen.has(this)) {
      tracking.seen.add(this);
      tracking.sources.push(this);
      tracking.versions.push(this.version);
    }
  }
}

export class Signal<T> extends Source {
  constructor(private current: T) {
    super();
  }

  refresh(): void {}

  get value(): T {
    this.track();
    return this.current;
  }

  set value(next: T) {
    if (Object.is(next, this.current)) {
      return;
    }
    this.current = next;
    this.version++;
    for (const observer of this.observers) {
      markStale(observer);
    }
    if (batchDepth === 0) {
      flush();
    }
  }

  peek(): T {
    return this.current;
  }
}

abstract class Derived extends Source {
  state = STALE;
  sources: Source[] = [];
  private versions: number[] = [];
  private initialized = false;
  private computing = false;

  /** Whether this node sits in its sources' observer sets. */
  abstract linked(): boolean;
  protected abstract compute(): void;

  refresh(): void {
    if (this.computing) {
      throw new Error('Cycle detected: a computed read itself');
    }
    if (this.initialized && this.linked() && this.state === CLEAN) {
      return;
    }
    if (!this.initialized || this.sourcesChanged()) {
      this.recompute();
    }
    this.state = CLEAN;
  }

  private sourcesChanged(): boolean {
    for (let i = 0; i < this.sources.length; i++) {
      const source = this.sources[i];
      if (source === undefined) {
        continue;
      }
      source.refresh();
      if (source.version !== this.versions[i]) {
        return true;
      }
    }
    return false;
  }

  private recompute(): void {
    const next: Tracking = { sources: [], versions: [], seen: new Set() };
    const previous = tracking;
    tracking = next;
    this.computing = true;
    try {
      this.compute();
    } finally {
      tracking = previous;
      this.computing = false;
    }
    if (this.linked()) {
      for (const source of this.sources) {
        if (!next.seen.has(source)) {
          unobserve(source, this);
        }
      }
      const old = new Set(this.sources);
      for (const source of next.sources) {
        if (!old.has(source)) {
          observe(source, this);
        }
      }
    }
    this.sources = next.sources;
    this.versions = next.versions;
    this.initialized = true;
  }
}

export class Computed<T> extends Derived {
  private cell: { readonly value: T } | null = null;

  constructor(private readonly fn: () => T) {
    super();
  }

  linked(): boolean {
    return this.observers.size > 0;
  }

  protected compute(): void {
    const next = this.fn();
    if (this.cell === null || !Object.is(next, this.cell.value)) {
      this.cell = { value: next };
      this.version++;
    }
  }

  get value(): T {
    this.track();
    if (this.cell === null) {
      throw new Error('computed read before it computed');
    }
    return this.cell.value;
  }

  peek(): T {
    return untracked(() => this.value);
  }
}

class Effect extends Derived {
  private disposed = false;

  constructor(private readonly fn: () => void) {
    super();
  }

  linked(): boolean {
    return !this.disposed;
  }

  protected compute(): void {
    this.fn();
  }

  override refresh(): void {
    if (!this.disposed) {
      super.refresh();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const source of this.sources) {
      unobserve(source, this);
    }
    this.sources = [];
  }
}

function observe(source: Source, observer: Derived): void {
  if (source instanceof Computed && source.observers.size === 0) {
    // becoming observed: it was just read, so it's current; mark it clean so the next write reaches through it
    source.state = CLEAN;
    for (const upstream of source.sources) {
      observe(upstream, source);
    }
  }
  source.observers.add(observer);
}

function unobserve(source: Source, observer: Derived): void {
  source.observers.delete(observer);
  if (source instanceof Computed && source.observers.size === 0) {
    for (const upstream of source.sources) {
      unobserve(upstream, source);
    }
  }
}

function markStale(node: Derived): void {
  if (node.state !== CLEAN) {
    return;
  }
  node.state = STALE;
  if (node instanceof Effect) {
    queue.push(node);
  }
  for (const observer of node.observers) {
    markStale(observer);
  }
}

const MAX_RUNS = 100_000;

function flush(): void {
  if (flushing) {
    return;
  }
  flushing = true;
  let runs = 0;
  let failure: { error: unknown } | null = null;
  try {
    for (let i = 0; i < queue.length; i++) {
      if (++runs > MAX_RUNS) {
        throw new Error('Effects kept re-triggering each other; is an effect writing what it reads?');
      }
      try {
        queue[i]?.refresh();
      } catch (error) {
        // keep running the rest; the first error surfaces once the queue drains
        failure ??= { error };
      }
    }
  } finally {
    queue.length = 0;
    flushing = false;
  }
  if (failure !== null) {
    throw failure.error;
  }
}

export function signal<T>(value: T): Signal<T> {
  return new Signal(value);
}

export function computed<T>(fn: () => T): Computed<T> {
  return new Computed(fn);
}

/** Runs `fn` now and again whenever what it read changes. Returns the dispose. */
export function effect(fn: () => void): () => void {
  const node = new Effect(fn);
  batch(() => node.refresh());
  return () => node.dispose();
}

/** Writes inside `fn` notify once, when the outermost batch ends. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      flush();
    }
  }
}

export function untracked<T>(fn: () => T): T {
  const previous = tracking;
  tracking = null;
  try {
    return fn();
  } finally {
    tracking = previous;
  }
}
