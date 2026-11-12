import {
  ActionRunner,
  DefaultResolver,
  ModelScope,
  Watchable,
  type Action,
  type ActionState,
  type AnyAction,
  type Class,
  type Middleware,
  type Model,
  type ModelClass,
  type Outcome,
  type Provide,
  type ReadonlyWatchable,
  type Resolver,
} from '@beacon/core';
import { ContextKey, getOwner, onCleanup, provideContext, readContext, root, untrack } from '@beacon/core/internal';
import { createComponent, render } from 'dom-expressions/src/client.js';
import type { JSX } from 'dom-expressions/src/jsx.js';
import { installShortcuts } from './shortcuts';

const SCOPE = new ContextKey<ModelScope>('ModelScope');
const RESOLVER = new ContextKey<Resolver>('Resolver');
const RUNNER = new ContextKey<ActionRunner>('ActionRunner');

// the scope each view rendered in, by its root element, so a key press can find the scope it happened in
const elementScopes = new WeakMap<Node, ModelScope>();

function scopeOf(target: EventTarget | null): ModelScope | null {
  for (let node = target instanceof Node ? target : null; node !== null; node = node.parentNode) {
    const scope = elementScopes.get(node);
    if (scope !== undefined) {
      return scope;
    }
  }
  return null;
}

function requireContext<T>(key: ContextKey<T>): T {
  const value = readContext(key);
  if (value === undefined) {
    throw new Error(`No ${key.name}: views must render inside mount().`);
  }
  return value;
}

function instantiate(resolver: Resolver, models: ReadonlyArray<Model | ModelClass>): Model[] {
  return models.map((m) => (typeof m === 'function' ? resolver.resolve(m) : m));
}

export type MountOptions = {
  /** Models for the root scope. Classes are built by the resolver. */
  models?: ReadonlyArray<Model | ModelClass>;
  actions?: ReadonlyArray<Class<AnyAction>>;
  middleware?: readonly Middleware[];
  resolver?: Resolver;
};

export function mount(App: Component, element: Element, options: MountOptions = {}): () => void {
  const resolver = options.resolver ?? new DefaultResolver();
  const runner = new ActionRunner((options.actions ?? []).map((cls) => resolver.resolve(cls)));
  for (const middleware of options.middleware ?? []) {
    runner.use(middleware);
  }
  return render(() => {
    const scope = new ModelScope(null);
    scope.add(instantiate(resolver, options.models ?? []));
    onCleanup(() => scope.dispose());
    onCleanup(installShortcuts(runner, (target) => scopeOf(target) ?? scope, element.ownerDocument));
    return provideContext(
      [
        [SCOPE, scope],
        [RESOLVER, resolver],
        [RUNNER, runner],
      ],
      () => createComponent(App, {})
    );
  }, element);
}

type Instances<M extends readonly ModelClass[]> = {
  [K in keyof M]: M[K] extends ModelClass<infer T> ? T : never;
};

/**
 * A component that reads models from the nearest scope. `render` runs once;
 * call watchables inside JSX to bind them.
 */
export function view<const M extends readonly ModelClass[], P extends object = Record<string, never>>(
  models: M,
  render: (...args: [...Instances<M>, P]) => JSX.Element
): Component<P> {
  return (props) => {
    const scope = requireContext(SCOPE);
    const instances = models.map((m) => scope.get(m));
    // .map can't produce the mapped tuple type; each entry is scope.get(M[i]), i.e. Instances<M>[i]
    const result: JSX.Element = Reflect.apply(render, undefined, [...instances, props]);
    if (result instanceof Node) {
      elementScopes.set(result, scope);
    }
    return result;
  };
}

export type Component<P extends object = Record<string, never>> = (props: P) => JSX.Element;

export type ScopeProps = {
  /** Instances, or classes for the resolver to build. Disposed when the scope unmounts. */
  models?: ReadonlyArray<Model | ModelClass>;
  /** Values for a child resolver, e.g. `[[RunKey, key]]` with @beacon/inject. */
  provide?: readonly Provide[];
  children: JSX.Element;
};

export function Scope(props: ScopeProps): JSX.Element {
  const parentResolver = requireContext(RESOLVER);
  const resolver = props.provide === undefined ? parentResolver : parentResolver.child(props.provide);
  const scope = new ModelScope(requireContext(SCOPE));
  scope.add(instantiate(resolver, props.models ?? []));
  onCleanup(() => scope.dispose());
  return provideContext(
    [
      [SCOPE, scope],
      [RESOLVER, resolver],
    ],
    () => props.children
  );
}

export type ForProps<T> = {
  each: ReadonlyArray<T> | (() => ReadonlyArray<T>);
  children: (item: T) => JSX.Element;
};

/**
 * Keyed by item identity: a row is built once per item and moved, not rebuilt,
 * when the list changes.
 *
 * shortcut: the same item twice in one list renders once, upgrade to index-suffixed keys if that's needed.
 */
export function For<T>(props: ForProps<T>): JSX.Element {
  const owner = getOwner();
  let rows = new Map<T, { node: JSX.Element; dispose: () => void }>();
  onCleanup(() => {
    for (const row of rows.values()) {
      row.dispose();
    }
  });
  const nodes = (): JSX.Element[] => {
    const each = props.each;
    const items = typeof each === 'function' ? each() : each;
    return untrack(() => {
      const next = new Map<T, { node: JSX.Element; dispose: () => void }>();
      for (const item of items) {
        const row = rows.get(item) ?? root((dispose) => ({ node: props.children(item), dispose }), owner);
        rows.delete(item);
        next.set(item, row);
      }
      for (const row of rows.values()) {
        row.dispose();
      }
      rows = next;
      return [...next.values()].map((row) => row.node);
    });
  };
  // insert() takes accessors but JSX.Element doesn't model them; Solid's <For> makes the same cast
  return nodes as unknown as JSX.Element;
}

export type ScopedActions = {
  readonly all: readonly AnyAction[];
  /** Registered actions that apply in this view's scope, in registration order. Recomputes as applicability changes. */
  readonly applicable: ReadonlyWatchable<AnyAction[]>;
  execute(action: AnyAction, input?: unknown): Promise<Outcome>;
};

/** Every action as seen from this view's scope: what a command bar or palette lists. */
export function useActions(source = 'view'): ScopedActions {
  const runner = requireContext(RUNNER);
  const scope = requireContext(SCOPE);
  return {
    all: runner.all(),
    applicable: Watchable.from(() => runner.all().filter((action) => action.applicable(scope))),
    execute: (action, input) => runner.invoke(action, input, source, scope),
  };
}

export type BoundAction<P, Out> = {
  readonly action: Action<P, Out>;
  readonly applicable: ReadonlyWatchable<boolean>;
  /** Idle, running, or how the last run ended, whether from here, a shortcut or the palette. */
  readonly state: ReadonlyWatchable<ActionState>;
  readonly pending: ReadonlyWatchable<boolean>;
  execute(...input: P extends void ? [] : [P]): Promise<Outcome<Out>>;
};

/** An action bound to the scope this view rendered in. */
export function useAction<P, Out>(cls: Class<Action<P, Out>>, source = 'view'): BoundAction<P, Out> {
  const runner = requireContext(RUNNER);
  const scope = requireContext(SCOPE);
  const action = runner.get(cls);
  const state = runner.stateOf(action);
  return {
    action,
    applicable: Watchable.from(() => action.applicable(scope)),
    state,
    pending: Watchable.from(() => state().kind === 'running'),
    execute: (...input: unknown[]) => runner.invoke(action, input[0], source, scope),
  };
}
