// The README's hello world: the least an app needs to render, react and run an action.
import { Action, Model, Watchable, type ModelScope } from '@beacon/core';
import { mount, useAction, view } from '@beacon/dom';

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
