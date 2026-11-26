import type { ModelScope } from '@beacon/core';
import {
  For as CoreFor,
  Scope as CoreScope,
  appRoot,
  scopeOfElement,
  type Component as CoreComponent,
  type ForProps as CoreForProps,
  type MountOptions,
  type ScopeProps as CoreScopeProps,
} from '@beacon/core/internal';
import { render } from 'dom-expressions/src/client.js';
import type { JSX } from 'dom-expressions/src/jsx.js';
import { installShortcuts } from './shortcuts';

export { useAction, useActions, view } from '@beacon/core/internal';
export type { BoundAction, MountOptions, ScopedActions } from '@beacon/core/internal';

export type Component<P extends object = Record<string, never>> = CoreComponent<P, JSX.Element>;
export type ScopeProps = CoreScopeProps<JSX.Element>;
export type ForProps<T> = CoreForProps<T, JSX.Element>;

export const Scope: (props: ScopeProps) => JSX.Element = CoreScope;
export const For: <T>(props: ForProps<T>) => JSX.Element = CoreFor;

function scopeOf(target: EventTarget | null): ModelScope | null {
  for (let node = target instanceof Node ? target : null; node !== null; node = node.parentNode) {
    const scope = scopeOfElement(node);
    if (scope !== undefined) {
      return scope;
    }
  }
  return null;
}

export function mount(App: Component, element: Element, options: MountOptions = {}): () => void {
  return render(
    () =>
      appRoot(App, options, (runner, scope) =>
        installShortcuts(runner, (target) => scopeOf(target) ?? scope, element.ownerDocument)
      ),
    element
  );
}
