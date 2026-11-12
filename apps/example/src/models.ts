import { Model, Watchable, type AsyncWatchable } from '@beacon/core';
import type { FakeApi, ServerLoad, TodoRepository } from './services';

export class BigList extends Model {
  readonly count = Watchable.fromValue(100_000);
  readonly rows = Watchable.from(() => Array.from({ length: this.count() }, (_, i) => i));
}

export class Todo extends Model {
  readonly done: Watchable<boolean>;

  constructor(
    readonly text: string,
    done: boolean
  ) {
    super();
    this.done = Watchable.fromValue(done);
  }
}

export class TodoList extends Model {
  readonly draft = Watchable.fromValue('');
  readonly todos: Watchable<Todo[]>;
  readonly remaining = Watchable.from(() => this.todos().filter((t) => !t.done()).length);
  readonly completed = Watchable.from(() => this.todos().length - this.remaining());

  constructor(repo: TodoRepository) {
    super();
    this.todos = Watchable.fromValue(repo.load().map((t) => new Todo(t.text, t.done)));
    this.watch(
      Watchable.from(() => this.todos().map((t) => ({ text: t.text, done: t.done() }))),
      (todos) => repo.save(todos)
    );
  }

  add(text: string): void {
    this.todos.update((todos) => [...todos, new Todo(text, false)]);
  }

  remove(todo: Todo): void {
    this.todos.update((todos) => todos.filter((t) => t !== todo));
  }

  clearCompleted(): void {
    this.todos.update((todos) => todos.filter((t) => !t.done.snapshot()));
  }
}

/** Search as you type: debounced input, cancelled stale requests, results kept while the next loads. */
export class Search extends Model {
  readonly query = Watchable.fromValue('');
  /** What's actually being searched: the query once typing pauses. */
  readonly settled = Watchable.debounced(this.query, 250);
  readonly results: AsyncWatchable<string[]>;

  constructor(api: FakeApi) {
    super();
    this.results = Watchable.async({
      input: this.settled,
      load: (query, context) => api.search(query, context),
      whileReloading: 'keep',
    });
  }
}

/** The same poll twice, to show the difference between keeping and clearing data on reload. */
export class ServerStatus extends Model {
  readonly kept: AsyncWatchable<ServerLoad>;
  readonly cleared: AsyncWatchable<ServerLoad>;

  constructor(api: FakeApi) {
    super();
    this.kept = Watchable.async({ load: (context) => api.status(context), whileReloading: 'keep', every: 2_000 });
    this.cleared = Watchable.async({ load: (context) => api.status(context), whileReloading: 'clear', every: 2_000 });
  }
}
