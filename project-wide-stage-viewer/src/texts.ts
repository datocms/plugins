// The texts of the plugin, and the texts of react-ui that it changes, for the
// `texts` of every Canvas. A module constant: a new object on each render
// would render the whole plugin again.
export const TEXTS = {
  'stageViewer.selected':
    '{count, plural, one {# record selected} other {# records selected}}',
  'stageViewer.selectAllMatching':
    '{count, plural, one {Select # matching record} other {Select all # matching records}}',
  'stageViewer.moveHint':
    '{count, plural, one {The selected record moves to this stage.} other {The # selected records move to this stage.}}',
  'a11y.table.selectAll': 'Select all records on this page',
  'listFilter.noResults.description':
    'No records match the filters. Try other filters, or clear some of them.',
} as const;
