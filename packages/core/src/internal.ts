// For beacon's renderers (@beacon/dom, @beacon/terminal, @beacon/react), not
// for apps: effects, ownership, and the view layer every renderer re-exports.
// App code that reaches for these wants Model.watch or an action.
export * from './reactive';
export * from './shortcut';
export * from './views';
