import {
  Async,
  For,
  Scope,
  VirtualGrid,
  VirtualList,
  formatShortcut,
  useAction,
  useActions,
  view,
  type Component,
  type JSX,
} from '@beacon/dom';
import { Watchable, type AnyAction, type AsyncWatchable, type Outcome } from '@beacon/core';
import { ReactIsland } from '@beacon/react';
import { AddTodo, ClearCompleted, PingServer, RemoveTodo, ToggleTodo } from './actions';
import { CommandBar, completion, prefixMatches } from './command-bar';
import { BigList, Search, ServerStatus, Todo, TodoList } from './models';
import type { ServerLoad } from './services';
import { RowCount } from './RowCount.react';

const TodoInput = view([TodoList], (list) => {
  const add = useAction(AddTodo);
  return (
    <form
      class="prompt"
      onSubmit={(e) => {
        e.preventDefault();
        void add.execute();
      }}
    >
      <span class="dollar" aria-hidden="true">
        $
      </span>
      <input
        aria-label="new todo"
        placeholder="add a todo"
        value={list.draft()}
        onInput={(e) => list.draft.set(e.currentTarget.value)}
      />
      <button disabled={!add.applicable()}>add</button>
    </form>
  );
});

const TodoRow = view([Todo], (todo) => {
  const toggle = useAction(ToggleTodo);
  const remove = useAction(RemoveTodo);
  return (
    <li classList={{ done: todo.done() }}>
      <label>
        <input type="checkbox" checked={todo.done()} onChange={() => void toggle.execute()} />
        <span>{todo.text}</span>
      </label>
      <button class="ghost" aria-label={`remove ${todo.text}`} onClick={() => void remove.execute()}>
        ×
      </button>
    </li>
  );
});

const TodoItems = view([TodoList], (list) => (
  <ul>
    <For each={list.todos}>
      {(todo) => (
        // each row gets its own scope, so row actions find their Todo by type
        <Scope models={[todo]}>
          <TodoRow />
        </Scope>
      )}
    </For>
  </ul>
));

const Footer = view([TodoList], (list) => {
  const clear = useAction(ClearCompleted);
  return (
    <footer>
      <span>{list.remaining()} left</span>
      <button class="danger" disabled={!clear.applicable()} onClick={() => void clear.execute()}>
        clear completed <kbd>{formatShortcut(clear.action.shortcut ?? '')}</kbd>
      </button>
    </footer>
  );
});

function Label(props: { name: string; count: string | number }): JSX.Element {
  return (
    <p class="label">
      <span class="bracket">[</span> {props.name} <span class="bracket">]</span> <span class="count">{props.count}</span>
    </p>
  );
}

const TodosCard = view([TodoList], (list) => (
  <section class="card">
    <h1>todos</h1>
    <Label name="TODOS" count={list.todos().length} />
    <TodoInput />
    <TodoItems />
    <Footer />
    <p class="hint">
      focus a row and press <kbd>{formatShortcut('backspace')}</kbd> to remove it
    </p>
  </section>
));

const BigListCard = view([BigList], (list) => (
  <section class="card">
    <h2>big list</h2>
    <Label name="ROWS" count={list.count().toLocaleString()} />
    {/* a React component (Radix Slider) inside a beacon view, bound both ways to the model */}
    <ReactIsland component={RowCount} props={{ value: list.count, onChange: (n: number) => list.count.set(n) }} />
    <VirtualList each={list.rows} itemSize={28} class="virtual">
      {(n, index) => (
        <div class="vrow" classList={{ odd: index() % 2 === 1 }}>
          <span class="count">#</span>
          {n.toLocaleString()}
        </div>
      )}
    </VirtualList>
  </section>
));

function columnName(n: number): string {
  let name = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) {
    name = String.fromCharCode(65 + ((i - 1) % 26)) + name;
  }
  return name;
}

const GridCard: Component = () => (
  <section class="card">
    <h2>grid</h2>
    <Label name="CELLS" count="100,000 × 1,000" />
    <VirtualGrid rows={100_000} columns={1_000} rowSize={28} columnSize={88} class="virtual">
      {(row, column) => (
        <span class="cell">
          {columnName(column)}
          {row + 1}
        </span>
      )}
    </VirtualGrid>
  </section>
);

function describeOutcome(title: string, outcome: Outcome): string {
  switch (outcome.kind) {
    case 'completed':
      return `ran "${title}"`;
    case 'aborted':
      return `"${title}" ${outcome.reason}`;
    case 'failed':
      return `"${title}" failed: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`;
  }
}

/**
 * Type the start of an action; the rest of its title appears inline. Tab
 * accepts it, ↑↓ cycle between actions that match, Enter runs the one shown.
 * Only actions that apply right now are offered: add a todo and "Mark all
 * done" starts completing.
 */
const CommandInput = view([CommandBar], (bar) => {
  const actions = useActions('palette');
  const matches = Watchable.from(() => prefixMatches(actions.applicable(), bar.query()));
  const active = Watchable.from(() => {
    const list = matches();
    return list[Math.min(bar.selected(), list.length - 1)] ?? null;
  });
  const rest = Watchable.from(() => {
    const action = active();
    return action === null ? '' : completion(action.title, bar.query());
  });
  // the inline completion is aria-hidden, so say it out loud instead
  const suggestion = Watchable.from(() => {
    const action = active();
    const others = matches().length - 1;
    if (action === null) {
      return '';
    }
    return `${action.title}: tab to complete, enter to run${others > 0 ? `, ${others} more with arrow keys` : ''}`;
  });

  const run = async (action: AnyAction): Promise<void> => {
    bar.reset();
    bar.status.set(describeOutcome(action.title, await actions.execute(action)));
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const action = active.snapshot();
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.snapshot().length > 0) {
      e.preventDefault();
      bar.move(e.key === 'ArrowDown' ? 1 : -1, matches.snapshot().length);
    } else if (e.key === 'Tab' && action !== null && rest.snapshot() !== '') {
      // accept the completion instead of leaving the field
      e.preventDefault();
      bar.type(action.title);
      bar.selected.set(Math.max(0, matches.snapshot().indexOf(action)));
    } else if (e.key === 'Enter' && action !== null) {
      e.preventDefault();
      void run(action);
    } else if (e.key === 'Escape') {
      bar.reset();
    }
  };

  return (
    <div class="command">
      <div class="prompt">
        <span class="dollar" aria-hidden="true">
          $
        </span>
        <div class="command-field">
          <span class="command-ghost" aria-hidden="true">
            <span class="typed">{bar.query()}</span>
            {rest()}
          </span>
          <input
            aria-label="run an action"
            aria-autocomplete="inline"
            aria-describedby="command-suggestion"
            placeholder="type an action, e.g. mark"
            autocomplete="off"
            spellcheck={false}
            value={bar.query()}
            onInput={(e) => bar.type(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
      <span id="command-suggestion" class="sr-only" aria-live="polite">
        {suggestion()}
      </span>
      <p class="hint">
        {actions.applicable().length} of {actions.all.length} actions apply here · row actions only apply
        inside a row
      </p>
      <p class="hint" aria-live="polite">
        {bar.status()}
      </p>
    </div>
  );
});

const CommandCard: Component = () => (
  <section class="card">
    <h2>actions</h2>
    <Label name="RUN" count="tab completes · ↑↓ cycles · enter runs" />
    <CommandInput />
  </section>
);

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const SearchBox = view([Search], (search) => (
  <div>
    <div class="prompt">
      <span class="dollar" aria-hidden="true">
        $
      </span>
      <input
        aria-label="search languages"
        placeholder="search languages, e.g. sc"
        value={search.query()}
        onInput={(e) => search.query.set(e.currentTarget.value)}
      />
    </div>
    <Async
      of={search.results}
      loading={() => <p class="hint">searching…</p>}
      failed={(error, retry, previous) => (
        <div class="async-failed">
          <span>{errorText(error)}</span>
          <button onClick={retry}>retry</button>
          {previous === null ? null : <span class="hint">last results: {previous.join(', ') || 'none'}</span>}
        </div>
      )}
    >
      {(results, refreshing) => (
        <p classList={{ results: true, refreshing: refreshing() }} aria-busy={refreshing()}>
          {results().length === 0 ? 'no matches' : results().join(', ')}
        </p>
      )}
    </Async>
  </div>
));

function StatusLine(props: { label: string; of: AsyncWatchable<ServerLoad> }): JSX.Element {
  return (
    <div class="status-line">
      <span class="count">{props.label}</span>
      <Async
        of={props.of}
        loading={() => <span class="hint">checking…</span>}
        failed={(error, _retry, previous) => (
          <span class="error-text">
            {errorText(error)}
            {previous === null ? '' : ` · last load ${previous.load}%`}
          </span>
        )}
      >
        {(status, refreshing) => (
          <span classList={{ refreshing: refreshing() }}>
            load {status().load}% · {status().checkedAt.toLocaleTimeString()}
          </span>
        )}
      </Async>
    </div>
  );
}

const ServerCard = view([ServerStatus], (status) => {
  const ping = useAction(PingServer);
  const lastPing = Watchable.from(() => {
    const state = ping.state();
    switch (state.kind) {
      case 'idle':
        return 'not pinged yet';
      case 'running':
        return 'waiting for a reply…';
      case 'completed':
        return `replied in ${String(state.output)} ms`;
      case 'aborted':
        return `ping ${state.reason}`;
      case 'failed':
        return `ping failed: ${errorText(state.error)}`;
    }
  });
  return (
    <section class="card">
      <h2>server</h2>
      <Label name="ASYNC" count="loading · ready · failed, all required" />
      <SearchBox />
      <StatusLine label="polls, keeps data" of={status.kept} />
      <StatusLine label="polls, clears data" of={status.cleared} />
      <div class="status-line">
        <button disabled={ping.pending()} onClick={() => void ping.execute()}>
          {ping.pending() ? 'pinging…' : 'ping server'}
        </button>
        <span class="hint" aria-live="polite">
          {lastPing()}
        </span>
      </div>
    </section>
  );
});

export const App: Component = () => (
  <main class="page">
    <CommandCard />
    <ServerCard />
    <TodosCard />
    <BigListCard />
    <GridCard />
  </main>
);
