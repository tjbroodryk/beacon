/**
 * Measures what beacon costs a user: each fixture is built the way an app
 * would build it (the real Vite plugin, minified), then gzipped and brotlied.
 *
 *   bun run size           print the table
 *   bun run size --write   also rewrite the README's size section (CI does this on main)
 */
import beacon from '@beacon/dom/vite';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { build, type Rolldown } from 'vite';

const FIXTURES = [
  { label: 'Hello world app (core + dom, tree-shaken)', file: 'hello.tsx' },
  { label: '`@beacon/core`, every export', file: 'core.ts' },
  { label: '`@beacon/dom` + core, every export', file: 'dom.ts' },
  { label: '`@beacon/inject`, every export', file: 'inject.ts' },
];

const README = fileURLToPath(new URL('../../../README.md', import.meta.url));
const START = '<!-- size:start -->';
const END = '<!-- size:end -->';

type Size = { min: number; gzip: number; brotli: number };

function outputsOf(result: Awaited<ReturnType<typeof build>>): Rolldown.RolldownOutput[] {
  if (Array.isArray(result)) {
    return result;
  }
  // build() only returns a watcher in watch mode, which this never enables
  if (!('output' in result)) {
    throw new Error('expected build output, got a watcher');
  }
  return [result];
}

async function measure(file: string): Promise<Size> {
  const input = fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url));
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [beacon()],
    build: {
      write: false,
      minify: true,
      modulePreload: false,
      // keep the fixture's exports, so "every export" fixtures can't be tree-shaken to nothing
      rolldownOptions: { input, preserveEntrySignatures: 'strict' },
    },
  });
  const code = outputsOf(result)
    .flatMap((o) => o.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('');
  const bytes = Buffer.from(code);
  return {
    min: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(2)} kB`;

const rows: string[] = [];
for (const fixture of FIXTURES) {
  const size = await measure(fixture.file);
  rows.push(`| ${fixture.label} | ${kb(size.min)} | ${kb(size.gzip)} | ${kb(size.brotli)} |`);
}
const table = ['| Bundle | min | gzip | brotli |', '| --- | ---: | ---: | ---: |', ...rows].join('\n');
console.log(table);

if (process.argv.includes('--write')) {
  const readme = await readFile(README, 'utf8');
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end < start) {
    throw new Error(`README.md needs a ${START} … ${END} section to write into`);
  }
  const next = `${readme.slice(0, start + START.length)}\n${table}\n${readme.slice(end)}`;
  if (next !== readme) {
    await writeFile(README, next);
    console.log('README.md updated');
  }
}
