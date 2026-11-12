import { Model, Watchable } from '@beacon/core';

/**
 * Items whose title starts with `query`, ignoring case, in registration order.
 * Only prefixes: the completion is shown inline, so a match elsewhere in a
 * title would have nothing visible to show.
 */
export function prefixMatches<T extends { readonly title: string }>(items: readonly T[], query: string): T[] {
  const q = query.toLowerCase();
  if (q.trim() === '') {
    return [];
  }
  return items.filter((item) => item.title.toLowerCase().startsWith(q));
}

/** The rest of `title` after what was typed, when the title starts with it; '' otherwise. */
export function completion(title: string, query: string): string {
  if (query === '' || !title.toLowerCase().startsWith(query.toLowerCase())) {
    return '';
  }
  return title.slice(query.length);
}

export class CommandBar extends Model {
  readonly query = Watchable.fromValue('');
  /** Which of the matches the completion shows; ↑↓ cycle it. */
  readonly selected = Watchable.fromValue(0);
  /** What the last run did, read out to screen readers. */
  readonly status = Watchable.fromValue('');

  type(query: string): void {
    this.query.set(query);
    this.selected.set(0);
  }

  move(by: number, count: number): void {
    if (count === 0) {
      return;
    }
    this.selected.update((i) => (((i + by) % count) + count) % count);
  }

  reset(): void {
    this.query.set('');
    this.selected.set(0);
  }
}
