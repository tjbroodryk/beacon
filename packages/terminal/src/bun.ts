/// <reference path="../../dom/src/babel.d.ts" />
// Preload this (bunfig.toml: preload = ["@beacon/terminal/bun"]) to compile JSX
// to terminal nodes and point dom-expressions at beacon's reactive core.
import { transformAsync } from '@babel/core';
import typescript from '@babel/preset-typescript';
import domExpressions from 'babel-plugin-jsx-dom-expressions';
import { plugin } from 'bun';
import { readFile } from 'node:fs/promises';

plugin({
  name: 'beacon-terminal',
  setup(build) {
    // onResolve doesn't fire for bare specifiers at runtime; a virtual module does
    build.module('rxcore', async () => ({ exports: await import('@beacon/core/rxcore'), loader: 'object' }));
    build.onLoad({ filter: /^(?!.*\/node_modules\/).*\.[jt]sx$/ }, async ({ path }) => {
      const result = await transformAsync(await readFile(path, 'utf8'), {
        filename: path,
        babelrc: false,
        configFile: false,
        // bun ignores a plugin's source map, so keep line numbers true instead
        retainLines: true,
        presets: [[typescript, { onlyRemoveTypeImports: true }]],
        plugins: [[domExpressions, { moduleName: '@beacon/terminal/runtime', generate: 'universal' }]],
      });
      if (result?.code == null) {
        throw new Error(`beacon-terminal: babel produced nothing for ${path}`);
      }
      return { contents: result.code, loader: 'js' };
    });
  },
});
