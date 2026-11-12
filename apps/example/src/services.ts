import { token } from '@beacon/inject';

export const Store = token<Storage>('Storage');
export const Confirm = token<(message: string) => boolean>('Confirm');

export type SavedTodo = { text: string; done: boolean };

const KEY = 'beacon-example:todos';

export class TodoRepository {
  constructor(private readonly storage: Storage) {}

  load(): SavedTodo[] {
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(isSavedTodo) : [];
    } catch {
      return [];
    }
  }

  save(todos: SavedTodo[]): void {
    this.storage.setItem(KEY, JSON.stringify(todos));
  }
}

function isSavedTodo(value: unknown): value is SavedTodo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    typeof value.text === 'string' &&
    'done' in value &&
    typeof value.done === 'boolean'
  );
}
