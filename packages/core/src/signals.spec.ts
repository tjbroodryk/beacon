import { describe, expect, it } from 'vitest';
import { batch, computed, effect, signal, untracked } from './signals';

describe('signals', () => {
  it('runs a diamond once per change, never with half-updated inputs', () => {
    const a = signal(1);
    const b = computed(() => a.value * 2);
    const c = computed(() => a.value * 3);
    const seen: string[] = [];
    effect(() => {
      seen.push(`${b.value}+${c.value}`);
    });
    a.value = 2;
    expect(seen).toEqual(['2+3', '4+6']);
  });

  it('stops at a computed whose value comes out equal', () => {
    const n = signal(1);
    const parity = computed(() => n.value % 2);
    let runs = 0;
    effect(() => {
      parity.value;
      runs++;
    });
    n.value = 3;
    n.value = 5;
    expect(runs).toBe(1);
    n.value = 4;
    expect(runs).toBe(2);
  });

  it('follows dynamic dependencies and drops ones no longer read', () => {
    const useA = signal(true);
    const a = signal('a');
    const b = signal('b');
    const seen: string[] = [];
    effect(() => {
      seen.push(useA.value ? a.value : b.value);
    });
    useA.value = false;
    a.value = 'a2'; // no longer read: no run
    b.value = 'b2';
    expect(seen).toEqual(['a', 'b', 'b2']);
    expect(a.observers.size).toBe(0);
  });

  it('keeps an unobserved computed correct without linking it, so it can be collected', () => {
    const n = signal(1);
    let computes = 0;
    const doubled = computed(() => {
      computes++;
      return n.value * 2;
    });
    expect(doubled.value).toBe(2);
    expect(doubled.value).toBe(2);
    expect(computes).toBe(1);
    expect(n.observers.size).toBe(0);
    n.value = 5;
    expect(doubled.value).toBe(10);
  });

  it('links a computed while observed and unlinks it on dispose', () => {
    const n = signal(1);
    const doubled = computed(() => n.value * 2);
    const dispose = effect(() => {
      doubled.value;
    });
    expect(n.observers.has(doubled)).toBe(true);
    dispose();
    expect(n.observers.size).toBe(0);
    expect(doubled.observers.size).toBe(0);
  });

  it('notifies once per batch', () => {
    const a = signal(1);
    const b = signal(2);
    let runs = 0;
    effect(() => {
      a.value + b.value;
      runs++;
    });
    batch(() => {
      a.value = 10;
      b.value = 20;
    });
    expect(runs).toBe(2);
  });

  it('lets effects write signals other effects read', () => {
    const source = signal(1);
    const mirror = signal(0);
    const seen: number[] = [];
    effect(() => {
      mirror.value = source.value * 10;
    });
    effect(() => {
      seen.push(mirror.value);
    });
    source.value = 2;
    expect(seen).toEqual([10, 20]);
  });

  it("doesn't track reads inside untracked or peek", () => {
    const a = signal(1);
    const b = signal(1);
    let runs = 0;
    effect(() => {
      untracked(() => a.value);
      b.peek();
      runs++;
    });
    a.value = 2;
    b.value = 2;
    expect(runs).toBe(1);
  });

  it('reports a computed that reads itself, and effects that feed each other forever', () => {
    const self = computed((): number => self.value + 1);
    expect(() => self.value).toThrow('Cycle detected');

    const a = signal(0);
    const b = signal(0);
    effect(() => {
      b.value = a.value + 1;
    });
    expect(() =>
      effect(() => {
        a.value = b.value + 1;
      })
    ).toThrow('kept re-triggering');
  });

  it("doesn't re-run an effect for its own write", () => {
    const n = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      n.value = n.peek() + 1;
    });
    expect([runs, n.peek()]).toEqual([1, 1]);
  });

  it('runs the remaining effects when one throws, then rethrows', () => {
    const n = signal(0);
    let ran = false;
    effect(() => {
      if (n.value === 1) {
        throw new Error('boom');
      }
    });
    effect(() => {
      n.value;
      ran = true;
    });
    ran = false;
    expect(() => (n.value = 1)).toThrow('boom');
    expect(ran).toBe(true);
  });
});
