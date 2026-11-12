declare module '@babel/preset-typescript' {
  import type { PluginItem } from '@babel/core';
  const preset: PluginItem;
  export default preset;
}

declare module 'babel-plugin-jsx-dom-expressions' {
  import type { PluginItem } from '@babel/core';
  const plugin: PluginItem;
  export default plugin;
}
