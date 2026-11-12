/// <reference path="./babel.d.ts" />
import { transformAsync } from '@babel/core';
import typescript from '@babel/preset-typescript';
import domExpressions from 'babel-plugin-jsx-dom-expressions';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Compiles JSX to direct DOM bindings and points dom-expressions at beacon's reactive core. */
export default function beacon(): Plugin {
  return {
    name: 'beacon',
    enforce: 'pre',
    config: () => ({
      resolve: { alias: { rxcore: fileURLToPath(new URL('./rxcore.ts', import.meta.url)) } },
      // prebundling would resolve dom-expressions' "rxcore" import before the alias applies
      optimizeDeps: { exclude: ['dom-expressions', '@beacon/dom', '@beacon/core'] },
      // by the time Vite's own transform runs, only *.react.tsx files still contain JSX
      oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
    }),
    async transform(code, id) {
      const file = id.split('?')[0] ?? id;
      // *.react.tsx holds React components for islands; Vite's own JSX transform handles those
      if (!/\.[jt]sx$/.test(file) || /\.react\.[jt]sx$/.test(file) || file.includes('/node_modules/')) {
        return null;
      }
      const result = await transformAsync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        presets: [[typescript, { onlyRemoveTypeImports: true }]],
        plugins: [
          [
            domExpressions,
            { moduleName: '@beacon/dom', generate: 'dom', delegateEvents: true, wrapConditionals: true },
          ],
        ],
      });
      if (result?.code == null) {
        return null;
      }
      return { code: result.code, map: result.map };
    },
  };
}
