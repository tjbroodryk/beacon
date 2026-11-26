import { Action, Model, Watchable, type ModelScope } from '@beacon/core';
import { parseShortcut } from '@beacon/core/internal';
import { afterEach, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { For, mount, view, type Component, type TerminalOptions } from './index';
import { matchesKey } from './mount';

class Counter extends Model {
  readonly count = Watchable.fromValue(0);
  readonly items = Watchable.fromValue(['a', 'b']);
}

class Increment extends Action {
  readonly title = 'Increment';
  override readonly shortcut = 'up';
  execute(_: void, scope: ModelScope): void {
    scope.get(Counter).count.update((n) => n + 1);
  }
}

let unmount = (): void => {};
afterEach(() => unmount());

function start(App: Component, options: TerminalOptions = {}, columns = 20) {
  const writes: string[] = [];
  unmount = mount(App, { ...options, stdout: { columns, write: (text) => writes.push(text) } });
  return {
    writes,
    /** The last frame as a person would see it. */
    screen: () => stripVTControlCharacters(writes.at(-1) ?? '').replace('\r', '').trimEnd(),
    // paints are batched into a microtask; keypresses arrive on a later tick still
    settle: () => new Promise((resolve) => setTimeout(resolve, 10)),
  };
}

test('lays out boxes: border, padding, column, and a row that shares spare width', () => {
  const { screen } = start(() => (
    <box border flexDirection="column">
      <text>title</text>
      <box gap={1}>
        <text>left</text>
        <box flexGrow={1} />
        <text>right</text>
      </box>
    </box>
  ));
  expect(screen()).toBe(
    ['╭──────────────────╮', '│title             │', '│left         right│', '╰──────────────────╯'].join('\n')
  );
});

test('wraps text at the width its box leaves it', () => {
  const { screen } = start(() => (
    <box width={7} padding={1}>
      <text>abcdefgh</text>
    </box>
  ));
  expect(screen()).toBe(['', ' abcde', ' fgh'].join('\n'));
});

test('aligns and justifies, and shrinks text to fit a row before it overflows', () => {
  const { screen } = start(
    () => (
      <box flexDirection="column">
        <box justifyContent="space-between">
          <text>a</text>
          <text>b</text>
        </box>
        <box alignItems="center" height={4}>
          <text>123456</text>
          <text>abcdef</text>
        </box>
      </box>
    ),
    {},
    10
  );
  expect(screen()).toBe(['a        b', '', '12345abcde', '6    f'].join('\n'));
});

test('nested text adds to the style around it', () => {
  const { writes } = start(() => (
    <text bold>
      a<text color="green">b</text>
      <text color="#ff8000">c</text>
    </text>
  ));
  expect(writes.at(-1)).toContain('\x1b[1ma\x1b[0m\x1b[1m\x1b[32mb\x1b[0m\x1b[1m\x1b[38;2;255;128;0mc\x1b[0m');
});

test('repaints in place when a watchable changes, once per tick', async () => {
  const counter = new Counter();
  const App = view([Counter], (c) => (
    <box flexDirection="column">
      <text>count {c.count()}</text>
      <For each={c.items}>{(item) => <text>- {item}</text>}</For>
    </box>
  ));
  const { writes, screen, settle } = start(App, { models: [counter] });
  expect(screen()).toBe('count 0\n- a\n- b');

  counter.count.set(1);
  counter.items.set(['b', 'c', 'a']);
  await settle();
  expect(screen()).toBe('count 1\n- b\n- c\n- a');
  expect(writes).toHaveLength(2);
  // back up over the three lines of the first frame, then clear down
  expect(writes[1]).toStartWith('\x1b[?2026h\x1b[3A\r\x1b[J');
});

test('keys run the action whose shortcut they match; Ctrl+C unmounts', async () => {
  const counter = new Counter();
  const stdin = new PassThrough();
  const App = view([Counter], (c) => <text>{c.count()}</text>);
  const { screen, settle } = start(App, { models: [counter], actions: [Increment], stdin });

  stdin.write('\x1b[A');
  await settle();
  expect(screen()).toBe('1');

  stdin.write('\x03');
  await settle();
  counter.count.set(5);
  await settle();
  expect(screen()).toBe('1');
});

test('mod is Ctrl in a terminal, and ⌘ shortcuts never match', () => {
  const ctrlK = { name: 'k', ctrl: true, meta: false, shift: false, sequence: '\x0b' };
  expect(matchesKey(parseShortcut('mod+k'), ctrlK)).toBe(true);
  expect(matchesKey(parseShortcut('k'), ctrlK)).toBe(false);
  expect(matchesKey(parseShortcut('meta+k'), ctrlK)).toBe(false);
  expect(matchesKey(parseShortcut('?'), { sequence: '?' })).toBe(true);
});
