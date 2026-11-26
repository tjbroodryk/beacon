import type { ActionRunner, ModelScope } from '@beacon/core';
import { appRoot, parseShortcut, root, untrack, type Combo, type MountOptions } from '@beacon/core/internal';
import { emitKeypressEvents, type Key } from 'node:readline';
import type { Component } from './index';
import { frame } from './paint';
import { TermNode, insert } from './runtime';

export type Output = {
  /** Missing or 0 when the output isn't a sized terminal; frames are then 80 wide. */
  readonly columns?: number;
  write(text: string): unknown;
};

export type Input = NodeJS.ReadableStream & {
  readonly isTTY?: boolean;
  setRawMode?(raw: boolean): unknown;
};

export type TerminalOptions = MountOptions & {
  /** Defaults to process.stdout. */
  stdout?: Output;
  /** Defaults to process.stdin when it is a terminal; without one, shortcuts are off. */
  stdin?: Input;
};

// node:readline's names for the keys DOM calls something else
const KEY_NAMES: Record<string, string> = {
  return: 'enter',
  space: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
};

/**
 * Whether a keypress is this shortcut. A terminal never sees ⌘, so `mod` is
 * Ctrl on every platform and `meta` shortcuts can't fire; what readline calls
 * meta is Alt.
 */
export function matchesKey(combo: Combo, key: Key): boolean {
  if (combo.meta) {
    return false;
  }
  const name = key.name === undefined ? key.sequence : (KEY_NAMES[key.name] ?? key.name);
  return (
    name === combo.key &&
    (key.ctrl ?? false) === (combo.ctrl || combo.mod) &&
    (key.meta ?? false) === combo.alt &&
    (key.shift ?? false) === combo.shift
  );
}

/**
 * Renders below the cursor, like Ink: each frame replaces the last one in
 * place, and the final frame stays in the scrollback after unmount. Ctrl+C
 * unmounts unless an action claims it.
 *
 * shortcut: every change rewrites the whole frame, and a frame taller than the terminal smears, upgrade to
 * a cell diff on the alternate screen when an app goes fullscreen.
 */
export function mount(App: Component, options: TerminalOptions = {}): () => void {
  const stdout = options.stdout ?? process.stdout;
  const stdin: Input | null = options.stdin ?? (process.stdin.isTTY ? process.stdin : null);
  const top = new TermNode('box');
  top.props.flexDirection = 'column';

  let last = '';
  let height = 0;
  let queued = false;
  const paint = (): void => {
    queued = false;
    // a pty that was never sized reports 0 columns
    const next = frame(top, stdout.columns || 80);
    if (next === last) {
      return;
    }
    const up = height > 0 ? `\x1b[${height}A` : '';
    // mode 2026 (synchronized output) keeps Ghostty, kitty and friends from showing a half-drawn frame
    stdout.write(`\x1b[?2026h${up}\r\x1b[J${next}\n\x1b[?2026l`);
    last = next;
    height = next.split('\n').length;
  };
  // one paint per tick however many bindings an action touched
  top.onChange = () => {
    if (!queued) {
      queued = true;
      queueMicrotask(paint);
    }
  };

  let unmount = (): void => {};
  const wire = (runner: ActionRunner, scope: ModelScope): (() => void) => {
    process.stdout.on('resize', paint);
    const unwatchResize = (): void => void process.stdout.off('resize', paint);
    if (stdin === null) {
      return unwatchResize;
    }
    // shortcut: there is no focus yet, so every shortcut runs against the root scope, upgrade when views can take focus.
    const onKey = (_: string | undefined, key: Key): void => {
      for (const action of runner.all()) {
        if (action.shortcut === null || !matchesKey(parseShortcut(action.shortcut), key)) {
          continue;
        }
        if (!untrack(() => action.applicable(scope))) {
          continue;
        }
        void runner.invoke(action, undefined, 'shortcut', scope);
        return;
      }
      if (key.ctrl === true && key.name === 'c') {
        unmount();
      }
    };
    emitKeypressEvents(stdin);
    stdin.setRawMode?.(true);
    stdin.on('keypress', onKey);
    stdin.resume();
    return () => {
      unwatchResize();
      stdin.off('keypress', onKey);
      stdin.setRawMode?.(false);
      // a flowing stdin would keep the process alive
      stdin.pause();
    };
  };

  // the renderer's own render() is typed for a single node; an app can return anything insert() takes
  const dispose = root((stop) => {
    insert(top, appRoot(App, options, wire));
    return stop;
  }, null);
  paint();
  unmount = () => {
    top.onChange = undefined;
    dispose();
  };
  return unmount;
}
