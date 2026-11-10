import s from './graph.module.css';

/**
 * The state classes that the export and import node wrappers pass as the
 * `className` of ItemTypeNodeRenderer and PluginNodeRenderer: a node in the
 * export, a node left out of the export (or reused by the import), the
 * focused node of the import (in the selected colors), and the focused node
 * of the export (a ring, which leaves the colors to the state of the node).
 * A conflict is a choice to make, not a problem: its pill alone tells it.
 */
export const nodeState = {
  included: s.included,
  excluded: s.excluded,
  focused: s.focused,
  current: s.current,
};
