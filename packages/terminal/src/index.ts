import {
  For as CoreFor,
  Scope as CoreScope,
  type Component as CoreComponent,
  type ForProps as CoreForProps,
  type ScopeProps as CoreScopeProps,
} from '@beacon/core/internal';
import type { JSX } from './jsx-runtime';

export { useAction, useActions, view } from '@beacon/core/internal';
export type { BoundAction, MountOptions, ScopedActions } from '@beacon/core/internal';
export type { BoxProps, Color, JSX, TextProps } from './jsx-runtime';
export { mount, type Input, type Output, type TerminalOptions } from './mount';

export type Component<P extends object = Record<string, never>> = CoreComponent<P, JSX.Element>;
export type ScopeProps = CoreScopeProps<JSX.Element>;
export type ForProps<T> = CoreForProps<T, JSX.Element>;

export const Scope: (props: ScopeProps) => JSX.Element = CoreScope;
export const For: <T>(props: ForProps<T>) => JSX.Element = CoreFor;
