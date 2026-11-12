import { Model, Watchable } from '@beacon/core';
import type { TodoRepository } from './services';

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
  private readonly stopSaving: () => void;

  constructor(repo: TodoRepository) {
    super();
    this.todos = Watchable.fromValue(repo.load().map((t) => new Todo(t.text, t.done)));
    this.stopSaving = Watchable.from(() =>
      this.todos().map((t) => ({ text: t.text, done: t.done() }))
    ).subscribe((todos) => repo.save(todos));
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

  override dispose(): void {
    this.stopSaving();
  }
}
