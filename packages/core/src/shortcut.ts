export type Combo = {
  readonly key: string;
  readonly mod: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
};

const MODIFIERS = new Set(['mod', 'ctrl', 'meta', 'alt', 'shift']);
export const SHORTCUT_ALIASES: Record<string, string> = {
  esc: 'escape',
  space: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
};

export function parseShortcut(shortcut: string): Combo {
  const parts = shortcut.toLowerCase().split('+');
  const key = parts.pop();
  if (key === undefined || key === '' || MODIFIERS.has(key)) {
    throw new Error(`Shortcut "${shortcut}" has no key`);
  }
  for (const part of parts) {
    if (!MODIFIERS.has(part)) {
      throw new Error(`Shortcut "${shortcut}": unknown modifier "${part}"`);
    }
  }
  return {
    key: SHORTCUT_ALIASES[key] ?? key,
    mod: parts.includes('mod'),
    ctrl: parts.includes('ctrl'),
    meta: parts.includes('meta'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
  };
}
