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

export type ServerLoad = { readonly load: number; readonly checkedAt: Date };

const LANGUAGES = [
  'Ada', 'Assembly', 'Bash', 'C', 'C#', 'C++', 'Clojure', 'COBOL', 'Crystal', 'D', 'Dart', 'Elixir',
  'Elm', 'Erlang', 'F#', 'Fortran', 'Gleam', 'Go', 'Groovy', 'Haskell', 'Java', 'JavaScript', 'Julia',
  'Kotlin', 'Lisp', 'Lua', 'MATLAB', 'Nim', 'OCaml', 'Odin', 'Pascal', 'Perl', 'PHP', 'Prolog',
  'Python', 'R', 'Racket', 'Ruby', 'Rust', 'Scala', 'Scheme', 'Smalltalk', 'SQL', 'Swift', 'Tcl',
  'TypeScript', 'V', 'Zig',
];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

const between = (min: number, max: number): number => min + Math.random() * (max - min);

/** Pretend backend: random latency and failures, so every async state shows up. */
export class FakeApi {
  async search(query: string, { signal }: { signal: AbortSignal }): Promise<string[]> {
    if (query.trim() === '') {
      return [];
    }
    await sleep(between(200, 900), signal);
    if (Math.random() < 0.15) {
      throw new Error('search service unavailable');
    }
    const q = query.trim().toLowerCase();
    return LANGUAGES.filter((name) => name.toLowerCase().includes(q));
  }

  async status({ signal }: { signal: AbortSignal }): Promise<ServerLoad> {
    await sleep(between(300, 800), signal);
    if (Math.random() < 0.15) {
      throw new Error('status check timed out');
    }
    return { load: Math.round(between(5, 95)), checkedAt: new Date() };
  }

  async ping(): Promise<number> {
    const start = performance.now();
    await sleep(between(300, 1_200));
    if (Math.random() < 0.25) {
      throw new Error('no reply');
    }
    return Math.round(performance.now() - start);
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
