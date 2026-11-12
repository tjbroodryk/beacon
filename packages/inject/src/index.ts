/**
 * A typed DI container. Classes stay plain: dependencies are constructor
 * parameters, and the wiring lives here, checked against those parameters.
 *
 * Structurally satisfies @beacon/core's `Resolver` without importing it.
 */

type Class<T> = abstract new (...args: never[]) => T;
type Concrete<T> = new (...args: never[]) => T;

export class Token<T> {
  declare readonly _type: T;
  constructor(readonly name: string) {}
}

export function token<T>(name: string): Token<T> {
  return new Token<T>(name);
}

export type Key<T> = Token<T> | Class<T>;

/** One key per constructor parameter, each resolving to that parameter's type. */
export type Deps<C extends Concrete<unknown>> = KeysOf<ConstructorParameters<C>>;

// a separate alias so the mapped type is homomorphic and keeps the tuple shape
type KeysOf<A extends readonly unknown[]> = { [K in keyof A]: Key<A[K]> };

type Binding = {
  readonly create: (container: Container) => unknown;
  /** 'singleton' caches in the container that declared it; 'scoped' in each child that resolves it. */
  readonly lifetime: 'singleton' | 'scoped';
};

function keyName(key: Key<unknown>): string {
  return key.name;
}

export class Container {
  private readonly bindings = new Map<object, Binding>();
  private readonly instances = new Map<object, unknown>();
  private readonly resolving: Key<unknown>[] = [];

  constructor(private readonly parent: Container | null = null) {}

  value<T>(key: Key<T>, value: T): this {
    this.instances.set(key, value);
    return this;
  }

  singleton<C extends Concrete<unknown>>(cls: C, deps: Deps<C>): this {
    return this.bind(cls, deps, 'singleton');
  }

  /** Built fresh in each child container (each `<Scope>`) that asks for it. */
  scoped<C extends Concrete<unknown>>(cls: C, deps: Deps<C>): this {
    return this.bind(cls, deps, 'scoped');
  }

  child(provide: ReadonlyArray<readonly [key: object, value: unknown]>): Container {
    const child = new Container(this);
    for (const [key, value] of provide) {
      child.instances.set(key, value);
    }
    return child;
  }

  resolve<T>(key: Key<T>): T {
    // the maps are heterogeneous; every write goes through a Key<T> of the same T
    return this.lookup(key, this) as T;
  }

  private bind<C extends Concrete<unknown>>(cls: C, deps: Deps<C>, lifetime: Binding['lifetime']): this {
    const keys: ReadonlyArray<Key<unknown>> = deps;
    this.bindings.set(cls, {
      lifetime,
      create: (container) => Reflect.construct(cls, keys.map((dep) => container.resolve(dep))),
    });
    return this;
  }

  private lookup(key: Key<unknown>, requester: Container): unknown {
    if (requester.instances.has(key)) {
      return requester.instances.get(key);
    }
    for (let c: Container | null = this; c !== null; c = c.parent) {
      if (c !== requester && c.instances.has(key)) {
        return c.instances.get(key);
      }
      const binding = c.bindings.get(key);
      if (binding === undefined) {
        continue;
      }
      // a singleton only sees its own container and up, so it can't capture a scoped value
      const owner = binding.lifetime === 'singleton' ? c : requester;
      return owner.build(key, binding);
    }
    // a class with no constructor parameters needs no wiring
    if (typeof key === 'function' && key.length === 0) {
      return requester.build(key, { lifetime: 'singleton', create: () => Reflect.construct(key, []) });
    }
    throw new Error(this.missing(key, requester));
  }

  private build(key: Key<unknown>, binding: Binding): unknown {
    if (this.resolving.includes(key)) {
      throw new Error(`Circular dependency: ${[...this.resolving, key].map(keyName).join(' → ')}`);
    }
    this.resolving.push(key);
    try {
      const instance = binding.create(this);
      this.instances.set(key, instance);
      return instance;
    } finally {
      this.resolving.pop();
    }
  }

  private missing(key: Key<unknown>, requester: Container): string {
    const chain = requester.resolving.map(keyName);
    const via = chain.length > 0 ? ` (needed by ${chain.join(' → ')})` : '';
    return (
      `Nothing provides ${keyName(key)}${via}. ` +
      `Bind it with container.singleton/scoped/value, or <Scope provide={[[${keyName(key)}, …]]}>.`
    );
  }
}
