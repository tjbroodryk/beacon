// Only for TypeScript's `jsxImportSource`; the bun plugin compiles JSX itself.
import type { TermNode } from './runtime';

export type Color =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'gray'
  | `#${string}`;

export type BoxProps = {
  /** Defaults to 'row', as in CSS. */
  flexDirection?: 'row' | 'column';
  /** Share of the parent's spare room along its direction. */
  flexGrow?: number;
  /** Defaults to 1, as in CSS: a box gives up width before its text overflows. */
  flexShrink?: number;
  /** Across the direction. Defaults to 'stretch'. */
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
  /** Along the direction. Defaults to 'flex-start'. */
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around';
  /** In cells. Without one a box is as big as its content. */
  width?: number;
  height?: number;
  padding?: number;
  /** Cells between children. */
  gap?: number;
  border?: boolean;
  children?: JSX.Element;
};

export type TextProps = {
  color?: Color;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  /** Swaps foreground and background: the usual way to show a selected row. */
  inverse?: boolean;
  /** Strings, numbers, and nested <text> that adds to this one's style. */
  children?: JSX.Element;
};

export namespace JSX {
  export type Element = TermNode | Element[] | (() => Element) | string | number | boolean | null | undefined;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export interface IntrinsicElements {
    box: BoxProps;
    text: TextProps;
  }
}
