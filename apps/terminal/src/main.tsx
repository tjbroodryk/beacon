import { Action, Model, Watchable, type ModelScope } from '@beacon/core';
import { For, mount, view } from '@beacon/terminal';

class Todo {
  readonly done = Watchable.fromValue(false);
  constructor(readonly text: string) {}
}

class Todos extends Model {
  readonly todos = Watchable.fromValue(['Write a renderer', 'Lay out boxes', 'Read the keyboard'].map((t) => new Todo(t)));
  readonly cursor = Watchable.fromValue(0);
  readonly selected = Watchable.from(() => this.todos()[this.cursor()]);
  readonly remaining = Watchable.from(() => this.todos().filter((t) => !t.done()).length);

  move(by: number): void {
    this.cursor.update((at) => Math.max(0, Math.min(this.todos.snapshot().length - 1, at + by)));
  }
}

class Up extends Action {
  readonly title = 'Up';
  override readonly shortcut = 'up';
  execute(_: void, scope: ModelScope): void {
    scope.get(Todos).move(-1);
  }
}

class Down extends Action {
  readonly title = 'Down';
  override readonly shortcut = 'down';
  execute(_: void, scope: ModelScope): void {
    scope.get(Todos).move(1);
  }
}

class Toggle extends Action {
  readonly title = 'Toggle';
  override readonly shortcut = 'space';
  override applicable(scope: ModelScope): boolean {
    return scope.get(Todos).selected() !== undefined;
  }
  execute(_: void, scope: ModelScope): void {
    scope.get(Todos).selected.snapshot()?.done.update((done) => !done);
  }
}

class Remove extends Action {
  readonly title = 'Remove';
  override readonly shortcut = 'backspace';
  override applicable(scope: ModelScope): boolean {
    return scope.get(Todos).selected() !== undefined;
  }
  execute(_: void, scope: ModelScope): void {
    const list = scope.get(Todos);
    const selected = list.selected.snapshot();
    list.todos.update((todos) => todos.filter((t) => t !== selected));
    list.move(0);
  }
}

const App = view([Todos], (list) => (
  <box border flexDirection="column" width={46}>
    <box>
      <text bold>Todos</text>
      <box flexGrow={1} />
      <text color={list.remaining() === 0 ? 'green' : 'yellow'}>{list.remaining()} left</text>
    </box>
    <For each={list.todos}>
      {(todo) => (
        <text inverse={list.selected() === todo} dim={todo.done()}>
          {todo.done() ? '[x]' : '[ ]'} {todo.text}
        </text>
      )}
    </For>
    <text dim>↑↓ move · space toggle · ⌫ remove · ^C quit</text>
  </box>
));

mount(App, { models: [Todos], actions: [Up, Down, Toggle, Remove] });
