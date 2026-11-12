import { fromValue } from './create-watchable';
import type { ModelScope } from './model-scope';
import type { Class } from './resolver';
import { batch } from './signals';
import type { ReadonlyWatchable, Watchable } from './watchable';

/** An action's state across every invocation: idle, running, or how the last one ended. */
export type ActionState<Out = unknown> = { readonly kind: 'idle' } | { readonly kind: 'running' } | Outcome<Out>;

type Tracked = { running: number; readonly state: Watchable<ActionState> };

/** The slice of Standard Schema (zod, valibot, arktype…) the runner needs. */
export type StandardSchema<T> = {
  readonly '~standard': {
    validate(
      value: unknown
    ):
      | StandardResult<T>
      | Promise<StandardResult<T>>;
  };
};

type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string }> };

export abstract class Action<P = void, Out = void> {
  abstract readonly title: string;
  /** e.g. 'mod+shift+backspace'; `mod` is ⌘ on macOS and Ctrl elsewhere. */
  readonly shortcut: string | null = null;
  /** Validated just before `execute`. Without one, the caller's input is trusted as-is. */
  readonly inputSchema: StandardSchema<P> | null = null;

  applicable(_scope: ModelScope): boolean {
    return true;
  }

  abstract execute(payload: P, scope: ModelScope): Promise<Out> | Out;
}

export type AnyAction = Action<unknown, unknown>;

export type Invocation = {
  readonly action: AnyAction;
  /** Whatever the caller had; middleware may replace it before validation. */
  readonly input: unknown;
  /** Who invoked it: 'view', 'shortcut', 'agent'… */
  readonly source: string;
  readonly scope: ModelScope;
};

export type Outcome<Out = unknown> =
  | { readonly kind: 'completed'; readonly output: Out }
  | { readonly kind: 'aborted'; readonly reason: string }
  | { readonly kind: 'failed'; readonly error: unknown };

export type Middleware = (
  invocation: Invocation,
  next: (invocation: Invocation) => Promise<Outcome>
) => Promise<Outcome>;

export class ActionRunner {
  private readonly middleware: Middleware[] = [];
  private readonly byClass = new Map<Function, AnyAction>();
  private readonly tracking = new Map<AnyAction, Tracked>();

  constructor(actions: readonly AnyAction[]) {
    for (const action of actions) {
      this.byClass.set(action.constructor, action);
    }
  }

  use(middleware: Middleware): this {
    this.middleware.push(middleware);
    return this;
  }

  all(): AnyAction[] {
    return [...this.byClass.values()];
  }

  get<A extends AnyAction>(cls: Class<A>): A {
    const action = this.byClass.get(cls);
    if (!(action instanceof cls)) {
      throw new Error(`${cls.name} isn't registered. Add it to mount(…, { actions: [${cls.name}] }).`);
    }
    return action;
  }

  /** Running while any invocation is in flight, then the last outcome. Whoever invoked it. */
  stateOf(action: AnyAction): ReadonlyWatchable<ActionState> {
    return this.tracked(action).state;
  }

  async invoke<P, Out>(
    action: Action<P, Out>,
    input: unknown,
    source: string,
    scope: ModelScope
  ): Promise<Outcome<Out>> {
    const run = this.middleware.reduceRight<(inv: Invocation) => Promise<Outcome>>(
      (next, middleware) => (inv) => middleware(inv, next),
      (inv) => this.execute(inv)
    );
    const tracked = this.tracked(action);
    tracked.running++;
    tracked.state.set({ kind: 'running' });
    // middleware sees actions untyped; the outcome's output is still the action's own
    const outcome = (await run({ action, input, source, scope })) as Outcome<Out>;
    tracked.running--;
    if (tracked.running === 0) {
      tracked.state.set(outcome);
    }
    return outcome;
  }

  private tracked(action: AnyAction): Tracked {
    let tracked = this.tracking.get(action);
    if (tracked === undefined) {
      tracked = { running: 0, state: fromValue<ActionState>({ kind: 'idle' }) };
      this.tracking.set(action, tracked);
    }
    return tracked;
  }

  private async execute(inv: Invocation): Promise<Outcome> {
    try {
      const schema = inv.action.inputSchema;
      let payload = inv.input;
      if (schema !== null) {
        const result = await schema['~standard'].validate(inv.input);
        if (result.issues !== undefined) {
          return { kind: 'failed', error: new Error(result.issues.map((i) => i.message).join('; ')) };
        }
        payload = result.value;
      }
      // one notification for everything an action writes before its first await
      const output = batch(() => inv.action.execute(payload, inv.scope));
      return { kind: 'completed', output: await output };
    } catch (error) {
      return { kind: 'failed', error };
    }
  }
}
