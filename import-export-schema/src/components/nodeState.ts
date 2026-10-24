import s from './graph.module.css';

/**
 * The state classes that the export and import node wrappers pass as the
 * `className` of ItemTypeNodeRenderer and PluginNodeRenderer: a node left out
 * of the export (or reused by the import), the focused node, and a node with
 * an unresolved conflict. They combine: a focused conflict gets a ring.
 */
export const nodeState = {
  excluded: s.excluded,
  focused: s.focused,
  conflict: s.conflict,
};
