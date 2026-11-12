import { Action, type Middleware, type ModelScope } from '@beacon/core';

// Ask-before-running, written in the app: beacon only provides the middleware hook.

export abstract class ConfirmableAction<P = void, Out = void> extends Action<P, Out> {
  abstract confirmation(scope: ModelScope): string;
}

export class ConfirmMiddleware {
  constructor(private readonly confirm: (message: string) => boolean) {}

  readonly handle: Middleware = async (inv, next) => {
    // an agent's call is its own consent; there's nobody to ask
    if (!(inv.action instanceof ConfirmableAction) || inv.source === 'agent') {
      return next(inv);
    }
    if (!this.confirm(inv.action.confirmation(inv.scope))) {
      return { kind: 'aborted', reason: 'cancelled' };
    }
    return next(inv);
  };
}

export const logMiddleware: Middleware = async (inv, next) => {
  const outcome = await next(inv);
  console.debug(`[action] ${inv.action.title} (${inv.source}): ${outcome.kind}`);
  return outcome;
};
