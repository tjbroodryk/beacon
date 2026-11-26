// What compiled JSX imports (createElement, insert, effect…). The bun plugin
// points the compiler here; apps import '@beacon/terminal', which doesn't expose these.
import { createRenderer } from 'dom-expressions/src/universal.js';

export class TermNode {
  parent: TermNode | undefined;
  readonly children: TermNode[] = [];
  readonly props: Record<string, unknown> = {};
  /** Set on the root by mount(); runs after any change beneath it. */
  onChange: (() => void) | undefined;

  constructor(
    /** 'box', 'text', or '#text' for a string child */
    readonly tag: string,
    public text = ''
  ) {}
}

function changed(node: TermNode): void {
  let top = node;
  while (top.parent !== undefined) {
    top = top.parent;
  }
  top.onChange?.();
}

function detach(node: TermNode): void {
  const siblings = node.parent?.children;
  if (siblings !== undefined) {
    siblings.splice(siblings.indexOf(node), 1);
  }
  node.parent = undefined;
}

export const {
  render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
} = createRenderer<TermNode>({
  createElement: (tag) => new TermNode(tag),
  createTextNode: (value) => new TermNode('#text', String(value)),
  isTextNode: (node) => node.tag === '#text',
  replaceText(node, value) {
    node.text = value;
    changed(node);
  },
  setProperty(node, name, value) {
    node.props[name] = value;
    changed(node);
  },
  insertNode(parent, node, anchor) {
    // a keyed row that moved is inserted again without being removed first
    detach(node);
    const at = anchor === undefined ? -1 : parent.children.indexOf(anchor);
    parent.children.splice(at === -1 ? parent.children.length : at, 0, node);
    node.parent = parent;
    changed(parent);
  },
  removeNode(parent, node) {
    detach(node);
    changed(parent);
  },
  getParentNode: (node) => node.parent,
  getFirstChild: (node) => node.children[0],
  getNextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1],
});
