import s from './graph.module.css';

/**
 * The state classes that the export and import node wrappers pass as the
 * `className` of ItemTypeNodeRenderer and PluginNodeRenderer: a node left out
 * of the export (or reused by the import), and the focused node. A conflict
 * is a choice to make, not a problem: its pill alone tells it.
 */
export const nodeState = {
  excluded: s.excluded,
  focused: s.focused,
};
