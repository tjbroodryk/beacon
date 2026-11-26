import { mount } from '@beacon/dom';
import { Container } from '@beacon/inject';
import {
  AddTenThousandRows,
  AddTodo,
  ClearCompleted,
  MarkAllDone,
  PingServer,
  RemoveTodo,
  ResetRows,
  ToggleTodo,
} from './actions';
import { CommandBar } from './command-bar';
import { ConfirmMiddleware, logMiddleware } from './confirm';
import { BigList, Search, ServerStatus, TodoList } from './models';
import { Confirm, FakeApi, Store, TodoRepository } from './services';
import { App } from './views';
import './tokens.css';
import './styles.css';

// the composition root: the only place that knows how things are built
const container = new Container()
  .value(Store, localStorage)
  .value(Confirm, (message: string) => window.confirm(message))
  .singleton(TodoRepository, [Store])
  .singleton(TodoList, [TodoRepository])
  .singleton(Search, [FakeApi])
  .singleton(ServerStatus, [FakeApi])
  .singleton(PingServer, [FakeApi])
  .singleton(ConfirmMiddleware, [Confirm]);

const root = document.getElementById('app');
if (root === null) {
  throw new Error('index.html is missing #app');
}

mount(App, root, {
  resolver: container,
  models: [TodoList, BigList, CommandBar, Search, ServerStatus],
  actions: [
    AddTodo,
    ToggleTodo,
    RemoveTodo,
    MarkAllDone,
    ClearCompleted,
    AddTenThousandRows,
    ResetRows,
    PingServer,
  ],
  middleware: [logMiddleware, container.resolve(ConfirmMiddleware).handle],
});
