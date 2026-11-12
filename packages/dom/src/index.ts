// the compiled JSX imports its helpers (template, insert, effect…) from here
export * from 'dom-expressions/src/client.js';
export type { JSX } from 'dom-expressions/src/jsx.js';
export * from './framework';
export { formatShortcut, parseShortcut } from './shortcuts';
export * from './virtual';
