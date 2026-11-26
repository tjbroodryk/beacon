// Layout and painting: a node tree in, one frame of text out. Yoga does the flexbox.
import Yoga, {
  Align,
  Direction,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  MeasureMode,
  type Node as YogaNode,
} from 'yoga-layout';
import type { TermNode } from './runtime';

type Cell = { readonly ch: string; readonly sgr: string };
type Grid = Cell[][];

const BLANK: Cell = { ch: ' ', sgr: '' };
const RESET = '\x1b[0m';
const FLAGS: Record<string, number> = { bold: 1, dim: 2, underline: 4, inverse: 7 };
const COLORS: Record<string, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
};
const ALIGN: Record<string, Align> = {
  'flex-start': Align.FlexStart,
  center: Align.Center,
  'flex-end': Align.FlexEnd,
  stretch: Align.Stretch,
};
const JUSTIFY: Record<string, Justify> = {
  'flex-start': Justify.FlexStart,
  center: Justify.Center,
  'flex-end': Justify.FlexEnd,
  'space-between': Justify.SpaceBetween,
  'space-around': Justify.SpaceAround,
};

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Escape codes for a <text>'s own props, after its parent's: later codes win, so nesting overrides. */
function sgrOf(props: Record<string, unknown>, inherited: string): string {
  const codes: Array<number | string> = [];
  for (const [prop, code] of Object.entries(FLAGS)) {
    if (props[prop] === true) {
      codes.push(code);
    }
  }
  const color = props.color;
  if (typeof color === 'string') {
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
    const named = COLORS[color];
    if (hex !== null) {
      codes.push(`38;2;${hex.slice(1).map((pair) => parseInt(pair, 16)).join(';')}`);
    } else if (named !== undefined) {
      codes.push(named);
    }
  }
  return codes.length === 0 ? inherited : `${inherited}\x1b[${codes.join(';')}m`;
}

// shortcut: one cell per code point, so CJK and emoji misalign what follows them, upgrade to a width table.
function cellsOf(node: TermNode, inherited: string): Cell[] {
  if (node.tag === '#text') {
    return [...node.text].map((ch) => ({ ch, sgr: inherited }));
  }
  const sgr = sgrOf(node.props, inherited);
  return node.children.flatMap((child) => cellsOf(child, sgr));
}

/** Breaks at newlines and at `width`, mid-word if it has to. */
function wrap(node: TermNode, width: number): Cell[][] {
  const lines: Cell[][] = [];
  let line: Cell[] = [];
  lines.push(line);
  for (const cell of cellsOf(node, '')) {
    if (cell.ch === '\n' || line.length >= Math.max(1, width)) {
      line = [];
      lines.push(line);
    }
    if (cell.ch !== '\n') {
      line.push(cell);
    }
  }
  return lines;
}

// shortcut: the Yoga tree is rebuilt for every frame, upgrade to Yoga nodes kept on the TermNodes if layout shows up in a profile.
function layoutOf(node: TermNode): YogaNode {
  const layout = Yoga.Node.create();
  // CSS's default; Yoga's own is 0, which overflows instead of wrapping text
  layout.setFlexShrink(num(node.props.flexShrink) ?? 1);
  if (node.tag !== 'box') {
    layout.setMeasureFunc((width, mode) => {
      const lines = wrap(node, mode === MeasureMode.Undefined ? Infinity : width);
      return { width: Math.max(...lines.map((line) => line.length)), height: lines.length };
    });
    return layout;
  }
  const props = node.props;
  layout.setFlexDirection(props.flexDirection === 'column' ? FlexDirection.Column : FlexDirection.Row);
  layout.setFlexGrow(num(props.flexGrow) ?? 0);
  layout.setWidth(num(props.width));
  layout.setHeight(num(props.height));
  layout.setPadding(Edge.All, num(props.padding) ?? 0);
  layout.setBorder(Edge.All, props.border === true ? 1 : 0);
  layout.setGap(Gutter.All, num(props.gap) ?? 0);
  layout.setAlignItems(ALIGN[String(props.alignItems)] ?? Align.Stretch);
  layout.setJustifyContent(JUSTIFY[String(props.justifyContent)] ?? Justify.FlexStart);
  node.children.forEach((child, i) => layout.insertChild(layoutOf(child), i));
  return layout;
}

function put(grid: Grid, x: number, y: number, cell: Cell): void {
  const row = grid[y];
  if (row !== undefined && x >= 0 && x < row.length) {
    row[x] = cell;
  }
}

function drawBorder(grid: Grid, x: number, y: number, w: number, h: number): void {
  if (w < 2 || h < 2) {
    return;
  }
  const right = x + w - 1;
  const bottom = y + h - 1;
  for (let c = x + 1; c < right; c++) {
    put(grid, c, y, { ch: '─', sgr: '' });
    put(grid, c, bottom, { ch: '─', sgr: '' });
  }
  for (let r = y + 1; r < bottom; r++) {
    put(grid, x, r, { ch: '│', sgr: '' });
    put(grid, right, r, { ch: '│', sgr: '' });
  }
  put(grid, x, y, { ch: '╭', sgr: '' });
  put(grid, right, y, { ch: '╮', sgr: '' });
  put(grid, x, bottom, { ch: '╰', sgr: '' });
  put(grid, right, bottom, { ch: '╯', sgr: '' });
}

// shortcut: content that overflows its box is drawn over whatever is next to it, upgrade to a clip rect when a view scrolls.
function draw(node: TermNode, layout: YogaNode, parentX: number, parentY: number, grid: Grid): void {
  const x = parentX + layout.getComputedLeft();
  const y = parentY + layout.getComputedTop();
  const w = layout.getComputedWidth();
  const h = layout.getComputedHeight();
  if (node.tag !== 'box') {
    wrap(node, w)
      .slice(0, h)
      .forEach((line, r) => line.forEach((cell, c) => put(grid, x + c, y + r, cell)));
    return;
  }
  if (node.props.border === true) {
    drawBorder(grid, x, y, w, h);
  }
  node.children.forEach((child, i) => draw(child, layout.getChild(i), x, y, grid));
}

function lineOf(cells: readonly Cell[]): string {
  let end = cells.length;
  while (end > 0 && cells[end - 1] === BLANK) {
    end--;
  }
  let out = '';
  let sgr = '';
  for (const cell of cells.slice(0, end)) {
    if (cell.sgr !== sgr) {
      // a cell's sgr is its whole chain from the root, so always start it from a clean slate
      out += (sgr === '' ? '' : RESET) + cell.sgr;
      sgr = cell.sgr;
    }
    out += cell.ch;
  }
  return sgr === '' ? out : out + RESET;
}

/** The tree as text, `columns` wide and as tall as its content. */
export function frame(root: TermNode, columns: number): string {
  const layout = layoutOf(root);
  try {
    layout.calculateLayout(columns, undefined, Direction.LTR);
    const height = layout.getComputedHeight();
    const grid: Grid = Array.from({ length: height }, () => Array.from({ length: columns }, () => BLANK));
    draw(root, layout, 0, 0, grid);
    return grid.map(lineOf).join('\n');
  } finally {
    // Yoga nodes live in wasm memory, which the garbage collector doesn't see
    layout.freeRecursive();
  }
}
