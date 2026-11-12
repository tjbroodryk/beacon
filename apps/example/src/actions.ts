import { Action, batch, type ModelScope } from '@beacon/core';
import { ConfirmableAction } from './confirm';
import { BigList, Todo, TodoList } from './models';

export class AddTodo extends Action {
  readonly title = 'Add todo';

  override applicable(scope: ModelScope): boolean {
    return scope.get(TodoList).draft().trim() !== '';
  }

  execute(_: void, scope: ModelScope): void {
    const list = scope.get(TodoList);
    list.add(list.draft.snapshot().trim());
    list.draft.set('');
  }
}

/** Reads the Todo from the row's own scope, so it applies only inside a row. */
export class ToggleTodo extends Action {
  readonly title = 'Toggle todo';

  override applicable(scope: ModelScope): boolean {
    return scope.has(Todo);
  }

  execute(_: void, scope: ModelScope): void {
    scope.get(Todo).done.update((done) => !done);
  }
}

export class RemoveTodo extends Action {
  readonly title = 'Remove todo';
  // only applies inside a row, so Backspace anywhere else is left alone
  override readonly shortcut = 'backspace';

  override applicable(scope: ModelScope): boolean {
    return scope.has(Todo);
  }

  execute(_: void, scope: ModelScope): void {
    scope.get(TodoList).remove(scope.get(Todo));
  }
}

export class MarkAllDone extends Action {
  readonly title = 'Mark all done';

  override applicable(scope: ModelScope): boolean {
    return scope.get(TodoList).remaining() > 0;
  }

  execute(_: void, scope: ModelScope): void {
    // one save, not one per todo
    batch(() => scope.get(TodoList).todos.snapshot().forEach((todo) => todo.done.set(true)));
  }
}

/** No applicable(): the base class makes it always available. */
export class AddTenThousandRows extends Action {
  readonly title = 'Add 10,000 rows';

  execute(_: void, scope: ModelScope): void {
    scope.get(BigList).count.update((n) => n + 10_000);
  }
}

export class ResetRows extends Action {
  readonly title = 'Reset rows to 100,000';

  override applicable(scope: ModelScope): boolean {
    return scope.get(BigList).count() !== 100_000;
  }

  execute(_: void, scope: ModelScope): void {
    scope.get(BigList).count.set(100_000);
  }
}

export class ClearCompleted extends ConfirmableAction {
  readonly title = 'Clear completed';
  override readonly shortcut = 'mod+shift+backspace';

  override applicable(scope: ModelScope): boolean {
    return scope.get(TodoList).completed() > 0;
  }

  confirmation(scope: ModelScope): string {
    const n = scope.get(TodoList).completed.snapshot();
    return `delete ${n} completed todo${n === 1 ? '' : 's'}?`;
  }

  execute(_: void, scope: ModelScope): void {
    scope.get(TodoList).clearCompleted();
  }
}
