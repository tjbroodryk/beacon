import { describe, expect, it } from 'vitest';
import {
  Action,
  ActionRunner,
  Model,
  ModelScope,
  Watchable,
  effect,
  isWatchable,
  memo,
  onCleanup,
  root,
  type Middleware,
} from './index';

describe('Watchable', () => {
  it('reads by calling, derives, and notifies subscribers of changes', () => {
    const first = Watchable.fromValue('Ada');
    const full = Watchable.from(() => `${first()} Lovelace`);
    const seen: string[] = [];
    full.subscribe((v) => seen.push(v));

    first.set('Grace');
    first.update((name) => name.toUpperCase());

    expect(full.snapshot()).toBe('GRACE Lovelace');
    expect(seen).toEqual(['Grace Lovelace', 'GRACE Lovelace']);
  });

  it('can be told apart from plain functions', () => {
    expect(isWatchable(Watchable.fromValue(1))).toBe(true);
    expect(isWatchable(Watchable.from(() => 1))).toBe(true);
    expect(isWatchable(() => 1)).toBe(false);
  });
});

describe('ownership', () => {
  it('disposes what an effect created when it re-runs, and everything on dispose', () => {
    const show = Watchable.fromValue(true);
    const count = Watchable.fromValue(0);
    const log: string[] = [];

    const dispose = root((dispose) => {
      effect(() => {
        if (show()) {
          effect(() => {
            log.push(`inner ${count()}`);
            return undefined;
          }, undefined);
          onCleanup(() => log.push('inner disposed'));
        }
        return undefined;
      }, undefined);
      return dispose;
    });

    count.set(1);
    show.set(false);
    count.set(2); // inner is gone, so nothing logs
    expect(log).toEqual(['inner 0', 'inner 1', 'inner disposed']);

    show.set(true);
    dispose();
    count.set(3);
    expect(log.slice(3)).toEqual(['inner 2', 'inner disposed']);
  });

  it('memo only recomputes on change and re-runs dependants', () => {
    const n = Watchable.fromValue(1);
    let runs = 0;
    root(() => {
      const isBig = memo(() => n() > 10);
      effect(() => {
        runs++;
        return isBig();
      }, false);
    });
    n.set(2);
    n.set(3);
    expect(runs).toBe(1);
    n.set(11);
    expect(runs).toBe(2);
  });
});

class Counter extends Model {
  readonly count = Watchable.fromValue(0);
}

class Increment extends Action<{ by: number }, number> {
  readonly title = 'Increment';
  override applicable(scope: ModelScope): boolean {
    return scope.has(Counter);
  }
  execute({ by }: { by: number }, scope: ModelScope): number {
    const counter = scope.get(Counter);
    counter.count.update((c) => c + by);
    return counter.count.snapshot();
  }
}

describe('ActionRunner', () => {
  const scope = (): ModelScope => {
    const s = new ModelScope(null);
    s.add([new Counter()]);
    return s;
  };

  it('runs middleware around execute, in order, and lets it replace input', async () => {
    const order: string[] = [];
    const log: Middleware = async (inv, next) => {
      order.push(`log ${inv.source}`);
      return next(inv);
    };
    const fill: Middleware = async (inv, next) => next({ ...inv, input: { by: 5 } });
    const runner = new ActionRunner([new Increment()]).use(log).use(fill);

    const outcome = await runner.invoke(runner.get(Increment), {}, 'view', scope());
    expect(outcome).toEqual({ kind: 'completed', output: 5 });
    expect(order).toEqual(['log view']);
  });

  it('lets middleware abort without running the action', async () => {
    const s = scope();
    const runner = new ActionRunner([new Increment()]).use(async () => ({ kind: 'aborted', reason: 'cancelled' }));
    expect(await runner.invoke(runner.get(Increment), { by: 1 }, 'view', s)).toEqual({
      kind: 'aborted',
      reason: 'cancelled',
    });
    expect(s.get(Counter).count.snapshot()).toBe(0);
  });

  it('turns throws and schema failures into failed outcomes', async () => {
    class Strict extends Increment {
      override readonly inputSchema = {
        '~standard': {
          validate: (v: unknown) =>
            typeof v === 'object' && v !== null && 'by' in v && typeof v.by === 'number'
              ? { value: { by: v.by } }
              : { issues: [{ message: 'by must be a number' }] },
        },
      };
    }
    const runner = new ActionRunner([new Strict()]);
    const outcome = await runner.invoke(runner.get(Strict), {}, 'view', new ModelScope(null));
    expect(outcome.kind).toBe('failed');
  });
});
