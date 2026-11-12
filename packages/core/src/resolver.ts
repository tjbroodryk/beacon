export type Class<T> = abstract new (...args: never[]) => T;

/** A `[key, value]` pair handed to a child resolver. The key's meaning belongs to the resolver. */
export type Provide = readonly [key: object, value: unknown];

/**
 * How the framework builds models and actions. Bring any container; the
 * default only knows `new Cls()`.
 */
export interface Resolver {
  resolve<T>(cls: Class<T>): T;
  child(provide: readonly Provide[]): Resolver;
}

export class DefaultResolver implements Resolver {
  resolve<T>(cls: Class<T>): T {
    if (cls.length > 0) {
      throw new Error(
        `${cls.name} takes constructor arguments, which the default resolver can't supply. ` +
          `Pass an instance, or mount with a container from @beacon/inject.`
      );
    }
    return Reflect.construct(cls, []);
  }

  child(provide: readonly Provide[]): Resolver {
    if (provide.length > 0) {
      throw new Error('`provide` needs a resolver that supports it, such as @beacon/inject.');
    }
    return this;
  }
}
