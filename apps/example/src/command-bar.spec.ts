import { describe, expect, it } from 'vitest';
import { CommandBar, completion, prefixMatches } from './command-bar';

const titles = (...names: string[]) => names.map((title) => ({ title }));

describe('prefixMatches', () => {
  const actions = titles('Add todo', 'Mark all done', 'Add 10,000 rows', 'Clear completed');

  it('matches title prefixes case-insensitively, in registration order', () => {
    expect(prefixMatches(actions, 'ADD').map((a) => a.title)).toEqual(['Add todo', 'Add 10,000 rows']);
    expect(prefixMatches(actions, 'clear completed').map((a) => a.title)).toEqual(['Clear completed']);
  });

  it('ignores matches inside a title, and suggests nothing until something is typed', () => {
    expect(prefixMatches(actions, 'done')).toEqual([]);
    expect(prefixMatches(actions, '  ')).toEqual([]);
  });
});

describe('completion', () => {
  it('completes a prefix case-insensitively, keeping the title casing', () => {
    expect(completion('Clear completed', 'cle')).toBe('ar completed');
    expect(completion('Clear completed', 'completed')).toBe('');
    expect(completion('Clear completed', '')).toBe('');
  });
});

describe('CommandBar', () => {
  it('wraps the selection both ways', () => {
    const bar = new CommandBar();
    bar.move(-1, 3);
    expect(bar.selected.snapshot()).toBe(2);
    bar.move(1, 3);
    expect(bar.selected.snapshot()).toBe(0);
    bar.move(1, 0);
    expect(bar.selected.snapshot()).toBe(0);
  });
});
