import type { ActionRunner, ModelScope } from '@beacon/core';
import { SHORTCUT_ALIASES as ALIASES, parseShortcut, untrack, type Combo } from '@beacon/core/internal';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function matches(combo: Combo, e: KeyboardEvent): boolean {
  const meta = combo.meta || (combo.mod && isMac);
  const ctrl = combo.ctrl || (combo.mod && !isMac);
  if (e.metaKey !== meta || e.ctrlKey !== ctrl || e.altKey !== combo.alt || e.shiftKey !== combo.shift) {
    return false;
  }
  // alt and shift change e.key ("˚", "K"); the physical code still says which letter or digit it was
  const fromCode = /^(?:Key|Digit)(.)$/.exec(e.code)?.[1]?.toLowerCase();
  return e.key.toLowerCase() === combo.key || fromCode === combo.key;
}

function hasModifier(combo: Combo): boolean {
  return combo.mod || combo.ctrl || combo.meta || combo.alt;
}

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);

function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUTS.has(target.type);
  }
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Runs the first action whose shortcut matches and which applies in the scope
 * of the focused element. When none applies the key is left alone, so the
 * browser keeps ⌘C, Backspace and the rest.
 */
export function installShortcuts(
  runner: ActionRunner,
  scopeFor: (target: EventTarget | null) => ModelScope,
  target: Document
): () => void {
  const combos = new Map<string, Combo>();
  const comboFor = (shortcut: string): Combo => {
    let combo = combos.get(shortcut);
    if (combo === undefined) {
      combo = parseShortcut(shortcut);
      combos.set(shortcut, combo);
    }
    return combo;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing) {
      return;
    }
    const scope = scopeFor(e.target);
    for (const action of runner.all()) {
      if (action.shortcut === null) {
        continue;
      }
      const combo = comboFor(action.shortcut);
      if (!matches(combo, e)) {
        continue;
      }
      // a bare key while typing is text, not a command
      if (!hasModifier(combo) && isTyping(e.target)) {
        continue;
      }
      if (!untrack(() => action.applicable(scope))) {
        continue;
      }
      e.preventDefault();
      void runner.invoke(action, undefined, 'shortcut', scope);
      return;
    }
  };

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

const MAC_SYMBOLS: Record<string, string> = {
  mod: '⌘',
  meta: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  backspace: '⌫',
  delete: '⌦',
  enter: '↩',
  escape: '⎋',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

/** For hints next to buttons: '⌘⇧⌫' on macOS, 'Ctrl+Shift+Backspace' elsewhere. */
export function formatShortcut(shortcut: string): string {
  const parts = shortcut.toLowerCase().split('+').map((p) => ALIASES[p] ?? p);
  if (isMac) {
    return parts.map((p) => MAC_SYMBOLS[p] ?? p.toUpperCase()).join('');
  }
  return parts
    .map((p) => (p === 'mod' ? 'ctrl' : p))
    .map((p) => (p === ' ' ? 'Space' : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('+');
}
