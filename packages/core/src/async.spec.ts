import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Action, ActionRunner, Model, ModelScope, Watchable, type AsyncState } from './index';
import { root } from './internal';

/** A request the test resolves or rejects by hand, recording whether it was aborted. */
function deferredRequest<T>() {
  const calls: Array<{ input: unknown; signal: AbortSignal; resolve: (v: T) => void; reject: (e: unknown) => void }> = [];
  const load = (input: unknown, { signal }: { signal: AbortSignal }): Promise<T> =>
    new Promise<T>((resolve, reject) => calls.push({ input, signal, resolve, reject }));
  return { calls, load };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const kinds = (states: Array<AsyncState<unknown>>): string[] =>
  states.map((s) => (s.kind === 'ready' ? `ready:${String(s.value)}${s.refreshing ? '…' : ''}` : s.kind));

describe('Watchable.async', () => {
  it('loads, then reloads when its input changes, ignoring the stale response', async () => {
    const query = Watchable.fromValue('a');
    const { calls, load } = deferredRequest<string>();
    const results = Watchable.async({ input: query, load, whileReloading: 'clear' });
    const seen: Array<AsyncState<string>> = [results.state.snapshot()];
    results.state.subscribe((s) => seen.push(s));

    query.set('ab');
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[1]!.resolve('AB');
    calls[0]!.resolve('A'); // lands late: must not overwrite
    await flush();

    expect(kinds(seen)).toEqual(['loading', 'ready:AB']);
    expect(calls.map((c) => c.input)).toEqual(['a', 'ab']);
  });

  it("'keep' shows the last value while reloading, and on failure", async () => {
    const { calls, load } = deferredRequest<number>();
    const n = Watchable.async({ load: (ctx) => load(undefined, ctx), whileReloading: 'keep' });
    calls[0]!.resolve(1);
    await flush();

    n.refresh();
    expect(n.state.snapshot()).toEqual({ kind: 'ready', value: 1, refreshing: true });
    calls[1]!.reject(new Error('down'));
    await flush();
    expect(n.state.snapshot()).toMatchObject({ kind: 'failed', previous: 1 });
  });

  it("'clear' goes back to loading and drops the value on failure", async () => {
    const { calls, load } = deferredRequest<number>();
    const n = Watchable.async({ load: (ctx) => load(undefined, ctx), whileReloading: 'clear' });
    calls[0]!.resolve(1);
    await flush();

    n.refresh();
    expect(n.state.snapshot()).toEqual({ kind: 'loading' });
    calls[1]!.reject(new Error('down'));
    await flush();
    expect(n.state.snapshot()).toMatchObject({ kind: 'failed', previous: null });
  });

  it('ready() waits for the request in flight, and rejects on failure with nothing in flight', async () => {
    const { calls, load } = deferredRequest<number>();
    const n = Watchable.async({ load: (ctx) => load(undefined, ctx), whileReloading: 'keep' });
    const first = n.ready();
    calls[0]!.resolve(7);
    await expect(first).resolves.toBe(7);
    await expect(n.ready()).resolves.toBe(7);

    n.refresh();
    calls[1]!.reject(new Error('down'));
    await flush();
    await expect(n.ready()).rejects.toThrow('down');
  });

  it('turns a throwing loader into a failed state', async () => {
    const n = Watchable.async({
      load: () => {
        throw new Error('sync throw');
      },
      whileReloading: 'clear',
    });
    await flush();
    expect(n.state.snapshot()).toMatchObject({ kind: 'failed' });
  });

  describe('polling', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('loads every interval until a value says stop, without flashing under keep', async () => {
      let tick = 0;
      const seen: string[] = [];
      const status = Watchable.async({
        load: async () => ++tick,
        whileReloading: 'keep',
        every: 1000,
        until: (n) => n === 3,
      });
      status.state.subscribe((s) => seen.push(kinds([s])[0]!));

      await vi.advanceTimersByTimeAsync(5000);
      expect(tick).toBe(3);
      expect(seen).toEqual(['ready:1', 'ready:1…', 'ready:2', 'ready:2…', 'ready:3']);
    });

    it('stops polling and aborts when disposed with its owner', async () => {
      let tick = 0;
      let signal: AbortSignal | null = null;
      const dispose = root((dispose) => {
        Watchable.async({
          load: async (ctx) => {
            signal = ctx.signal;
            return ++tick;
          },
          whileReloading: 'keep',
          every: 1000,
        });
        return dispose;
      });
      await vi.advanceTimersByTimeAsync(1500);
      dispose();
      await vi.advanceTimersByTimeAsync(5000);
      expect(tick).toBe(2);
      expect(signal!.aborted).toBe(false); // the last request had already landed
    });
  });
});

describe('rate control', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounced waits for quiet', () => {
    const q = Watchable.fromValue('');
    const settled = Watchable.debounced(q, 300);
    q.set('a');
    vi.advanceTimersByTime(200);
    q.set('ab');
    vi.advanceTimersByTime(200);
    expect(settled.snapshot()).toBe('');
    vi.advanceTimersByTime(100);
    expect(settled.snapshot()).toBe('ab');
  });

  it('throttled lets the first change through, then the latest per window', () => {
    const n = Watchable.fromValue(0);
    const t = Watchable.throttled(n, 100);
    n.set(1);
    expect(t.snapshot()).toBe(1);
    n.set(2);
    n.set(3);
    expect(t.snapshot()).toBe(1);
    vi.advanceTimersByTime(100);
    expect(t.snapshot()).toBe(3);
  });

  it('deferred applies only the latest value once idle', () => {
    const n = Watchable.fromValue(0);
    const d = Watchable.deferred(n);
    const seen: number[] = [];
    d.subscribe((v) => seen.push(v));
    n.set(1);
    n.set(2);
    vi.runAllTimers();
    expect(seen).toEqual([2]);
  });
});

describe('Model.watch', () => {
  it('runs on changes and stops when the scope disposes, even if dispose is overridden', () => {
    const count = Watchable.fromValue(0);
    const seen: number[] = [];
    class Logger extends Model {
      constructor() {
        super();
        this.watch(count, (n) => seen.push(n));
      }
      override dispose(): void {
        // forgot super.dispose(); watches are released anyway
      }
    }
    const scope = new ModelScope(null);
    scope.add([new Logger()]);
    count.set(1);
    scope.dispose();
    count.set(2);
    expect(seen).toEqual([1]);
  });
});

describe('action state', () => {
  it('is running while in flight, then the outcome, whoever invoked it', async () => {
    let finish = (): void => {};
    class Save extends Action {
      readonly title = 'Save';
      execute(): Promise<void> {
        return new Promise((resolve) => (finish = resolve));
      }
    }
    const runner = new ActionRunner([new Save()]);
    const save = runner.get(Save);
    const state = runner.stateOf(save);
    expect(state.snapshot()).toEqual({ kind: 'idle' });

    const done = runner.invoke(save, undefined, 'shortcut', new ModelScope(null));
    expect(state.snapshot()).toEqual({ kind: 'running' });
    finish();
    await done;
    expect(state.snapshot()).toEqual({ kind: 'completed', output: undefined });
  });

  it('batches what an action writes', async () => {
    const a = Watchable.fromValue(0);
    const b = Watchable.fromValue(0);
    const sums: number[] = [];
    Watchable.from(() => a() + b()).subscribe((s) => sums.push(s));
    class Both extends Action {
      readonly title = 'Both';
      execute(): void {
        a.set(1);
        b.set(1);
      }
    }
    const runner = new ActionRunner([new Both()]);
    await runner.invoke(runner.get(Both), undefined, 'view', new ModelScope(null));
    expect(sums).toEqual([2]);
  });
});
