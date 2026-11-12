# beacon

JSX without a virtual DOM, organised as models, views and actions in the style of
[watchtower](../watchables). Views run once; calling a watchable inside JSX binds
it straight to the DOM node that shows it.

```tsx
class Counter extends Model {
  readonly count = Watchable.fromValue(0);
}

class Increment extends Action {
  readonly title = 'Increment';
  execute(_: void, scope: ModelScope): void {
    scope.get(Counter).count.update((c) => c + 1);
  }
}

const App = view([Counter], (counter) => {
  const inc = useAction(Increment);
  return <button onClick={() => inc.execute()}>clicked {counter.count()} times</button>;
});

mount(App, document.body, { models: [Counter], actions: [Increment] });
```

## Size

What beacon adds to an app, minified and compressed. CI re-measures on every push to `main` and
commits the result here; run `bun run size` to measure locally.

<!-- size:start -->
| Bundle | min | gzip | brotli |
| --- | ---: | ---: | ---: |
| Hello world app (core + dom, tree-shaken) | 12.93 kB | 5.23 kB | 4.67 kB |
| `@beacon/core`, every export | 5.89 kB | 2.30 kB | 2.06 kB |
| `@beacon/dom` + core, every export | 27.59 kB | 10.74 kB | 9.58 kB |
| `@beacon/inject`, every export | 1.42 kB | 0.66 kB | 0.58 kB |
<!-- size:end -->

## Getting started

```bash
bun install
bun run dev        # the example app, http://localhost:5173
bun run test
bun run typecheck
```

## Packages

| Package | What it is |
| --- | --- |
| [`@beacon/core`](packages/core) | Callable watchables on `@preact/signals-core`, the ownership tree that disposes bindings, model scopes, actions with a middleware chain, and the `Resolver` interface. No DOM. |
| [`@beacon/dom`](packages/dom) | `mount`, `view`, `Scope`, `For` and `useAction`, plus the Vite plugin (`@beacon/dom/vite`) that compiles JSX with Solid's `babel-plugin-jsx-dom-expressions` against beacon's core. |
| [`@beacon/inject`](packages/inject) | An optional DI container. Classes stay plain; `container.singleton(Class, [deps])` is type-checked against the constructor. Satisfies `Resolver` without importing core. |
| [`@beacon/react`](packages/react) | `<ReactIsland>`: renders any React component (Radix, shadcn, a date picker) inside a view, with watchables as props. |
| [`example`](apps/example) | A command input over the applicable actions, todos (DI, per-row scopes, shortcuts, a confirm middleware), a virtual list sized by a Radix slider island, and a 100,000 × 1,000 virtual grid. |

## Out of the box

**Keyboard shortcuts** are a field on the action, so the same action serves a button and a key:

```ts
class ClearCompleted extends Action {
  readonly title = 'Clear completed';
  override readonly shortcut = 'mod+shift+backspace'; // ⌘ on macOS, Ctrl elsewhere
  …
}
```

A key press runs against the scope of the focused element, so a row-level `backspace` removes the
row that has focus. When no matching action applies there, the key is left to the browser.
Bare keys are ignored while typing in a text field. `formatShortcut()` renders hints (`⌘⇧⌫`).

**What applies here**: `useActions()` gives a view every action that applies in its scope as a live
list, recomputed as `applicable()` changes. Actions that don't define `applicable()` always apply.
The example's command input (`CommandInput` in `apps/example/src/views.tsx`) is built on it: type to
filter, Tab accepts the inline completion, Enter runs the action.

**Virtualization**: `<VirtualList each={…} itemSize={28} axis="vertical" | "horizontal">` and
`<VirtualGrid rows columns rowSize columnSize>` render only what's in view, with ARIA list and grid
roles, positions and counts. Item sizes are fixed for now.

**React components** run in islands. Write them in `*.react.tsx` files starting with
`/** @jsxImportSource react */`; the Vite plugin leaves those to React's JSX transform.

```tsx
<ReactIsland component={RowCount} props={{ value: list.count, onChange: (n: number) => list.count.set(n) }} />
```

Each island is its own React root, so React's bundle and context stop at the island boundary; wrap
any providers into the component you pass.

## Rules of the road

- **Call watchables to read them**: `{run.title()}`, `disabled={!save.applicable()}`. Calls inside JSX
  are tracked; `snapshot()` reads without tracking, for actions and other non-reactive code.
- **Views only read models.** A view's body runs once, so there is no state or effect hook. State
  lives in models, and side effects live in models too, cleaned up in `dispose()` when their scope goes.
- **Actions change things.** `applicable(scope)` is reactive, and `execute(payload, scope)` runs
  through middleware. Ask-or-execute, confirmation and logging are middleware your app writes;
  `apps/example/src/confirm.ts` shows one.
- **Constructors take dependencies.** Without a resolver, models and actions must have no constructor
  parameters, or be passed as instances. With `@beacon/inject`, the composition root wires them.

## Not built yet

A zag.js-based component kit, the command palette, the watchable variants (polling, persistent,
mixed-source), targeting, variable-size virtualization, devtools, `npm create`, and SSR (below).

## To do: server rendering

Most of the machinery already exists in what we build on. `dom-expressions` ships a server runtime
(`server.js`: `renderToString`, `renderToStream`, escaping) and client hydration (`hydrate`,
`getNextElement`), and its Babel plugin has `generate: 'ssr'` and `hydratable: true`. The work is
on our side of those seams:

1. **Two compile targets.** The Vite plugin's `transform` receives `options.ssr`. Compile with
   `generate: 'ssr'` for the server environment and `generate: 'dom', hydratable: true` for the
   client.
2. **A server reactive core.** Alias `rxcore` to a server variant where `effect` and `memo` run
   once and subscribe to nothing, and `createComponent` assigns hydration keys through
   `sharedConfig.context`, as Solid's does. Ship it as `@beacon/dom/server` with
   `renderToString(App, options)`.
3. **`hydrate(App, el, options)` beside `mount`.** It takes the same models, actions and
   resolver, but walks the server's DOM instead of creating it. The client `createComponent` has
   to produce the same keys as the server's.
4. **Model state transfer (the real design question).** The client must start from the server's
   model state or hydration mismatches. Models would opt in with `serialize(): Json` and a way to
   restore it, keyed by scope path and model type. The state goes into a
   `<script type="application/json">`, and the client resolver restores models from it instead of
   rebuilding them. dom-expressions' seroval serializer could carry it, and stream it with
   `renderToStream`.
5. **Async data.** The server has to wait for data before rendering. Models would expose a
   `ready: Promise<void>` that `renderToString` awaits per scope, rather than adding Suspense.
6. **Per-request isolation.** Each request gets its own container child and root scope. A
   module-level watchable would leak state between requests on the server, so model state must
   stay inside models.
7. **Client-only pieces need server fallbacks.** Shortcuts install only on the client.
   `VirtualList`/`VirtualGrid` take an initial viewport size and render that window (there's no
   scroll size on the server). `ReactIsland` renders with `react-dom/server` and hydrates with
   `hydrateRoot`.
