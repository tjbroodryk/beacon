// The half of a renderer that doesn't care what it renders to: scopes, views
// and actions. `E` is the renderer's JSX element type.
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
} from './index';
import { ContextKey, getOwner, onCleanup, provideContext, readContext, root, untrack } from './reactive';

const SCOPE = new ContextKey<ModelScope>('ModelScope');
const RESOLVER = new ContextKey<Resolver>('Resolver');
const RUNNER = new ContextKey<ActionRunner>('ActionRunner');

// the scope each view rendered in, by its root element, so input can find the scope it happened in
const elementScopes = new WeakMap<object, ModelScope>();

export function scopeOfElement(element: object): ModelScope | undefined {
  return elementScopes.get(element);
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

export type Component<P extends object, E> = (props: P) => E;

/**
 * What a renderer's mount() renders: the app inside its root scope. `wire`
 * hooks input up to the runner; what it returns runs on unmount.
 */
export function appRoot<E>(
  App: Component<Record<string, never>, E>,
  options: MountOptions,
  wire: (runner: ActionRunner, scope: ModelScope) => () => void
): E {
  const resolver = options.resolver ?? new DefaultResolver();
  const runner = new ActionRunner((options.actions ?? []).map((cls) => resolver.resolve(cls)));
  for (const middleware of options.middleware ?? []) {
    runner.use(middleware);
  }
  const scope = new ModelScope(null);
  scope.add(instantiate(resolver, options.models ?? []));
  onCleanup(() => scope.dispose());
  onCleanup(wire(runner, scope));
  return provideContext(
    [
      [SCOPE, scope],
      [RESOLVER, resolver],
      [RUNNER, runner],
    ],
    () => untrack(() => App({}))
  );
}

type Instances<M extends readonly ModelClass[]> = {
  [K in keyof M]: M[K] extends ModelClass<infer T> ? T : never;
};

/**
 * A component that reads models from the nearest scope. `render` runs once;
 * call watchables inside JSX to bind them.
 */
export function view<const M extends readonly ModelClass[], P extends object = Record<string, never>, E = unknown>(
  models: M,
  render: (...args: [...Instances<M>, P]) => E
): Component<P, E> {
  return (props) => {
    const scope = requireContext(SCOPE);
    const instances = models.map((m) => scope.get(m));
    // .map can't produce the mapped tuple type; each entry is scope.get(M[i]), i.e. Instances<M>[i]
    const result: E = Reflect.apply(render, undefined, [...instances, props]);
    if (typeof result === 'object' && result !== null) {
      elementScopes.set(result, scope);
    }
    return result;
  };
}

export type ScopeProps<E> = {
  /** Instances, or classes for the resolver to build. Disposed when the scope unmounts. */
  models?: ReadonlyArray<Model | ModelClass>;
  /** Values for a child resolver, e.g. `[[RunKey, key]]` with @beacon/inject. */
  provide?: readonly Provide[];
  children: E;
};

export function Scope<E>(props: ScopeProps<E>): E {
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

export type ForProps<T, E> = {
  each: ReadonlyArray<T> | (() => ReadonlyArray<T>);
  children: (item: T) => E;
};

/**
 * Keyed by item identity: a row is built once per item and moved, not rebuilt,
 * when the list changes.
 *
 * shortcut: the same item twice in one list renders once, upgrade to index-suffixed keys if that's needed.
 */
export function For<T, E>(props: ForProps<T, E>): E {
  const owner = getOwner();
  let rows = new Map<T, { node: E; dispose: () => void }>();
  onCleanup(() => {
    for (const row of rows.values()) {
      row.dispose();
    }
  });
  const nodes = (): E[] => {
    const each = props.each;
    const items = typeof each === 'function' ? each() : each;
    return untrack(() => {
      const next = new Map<T, { node: E; dispose: () => void }>();
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
  // insert() takes accessors but JSX element types don't model them; Solid's <For> makes the same cast
  return nodes as unknown as E;
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
