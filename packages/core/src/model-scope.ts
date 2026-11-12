/** A viewmodel. Holds watchables; `dispose` runs when its scope goes away. */
export abstract class Model {
  dispose(): void {}
}

export type ModelClass<T extends Model = Model> = abstract new (...args: never[]) => T;

/** Models registered for a subtree, found by type. Lookups walk up to the parent. */
export class ModelScope {
  private readonly models: Model[] = [];

  constructor(readonly parent: ModelScope | null) {}

  add(models: readonly Model[]): void {
    this.models.push(...models);
  }

  find<T extends Model>(type: ModelClass<T>): T | null {
    for (const model of this.models) {
      if (model instanceof type) {
        return model;
      }
    }
    return this.parent?.find(type) ?? null;
  }

  get<T extends Model>(type: ModelClass<T>): T {
    const model = this.find(type);
    if (model === null) {
      throw new Error(
        `No ${type.name} in scope (in scope: [${this.names().join(', ')}]). ` +
          `Provide it with <Scope models={[${type.name}]}>.`
      );
    }
    return model;
  }

  has(type: ModelClass): boolean {
    return this.find(type) !== null;
  }

  dispose(): void {
    for (const model of this.models.splice(0)) {
      model.dispose();
    }
  }

  private names(): string[] {
    const own = this.models.map((m) => m.constructor.name);
    return this.parent === null ? own : [...own, ...this.parent.names()];
  }
}
