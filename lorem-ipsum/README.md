# Lorem Ipsum plugin

Makes it easier to automatically fill your textual fields with dummy content.

## Configuration

You can either hook this plugin manually to your text fields (single-line, multi-paragraph, Structured Text), or automatically specifying a number of match rules.

## Changelog

- 0.2.6 - Fixed generated structured-text dummy content failing field validation with "Format not valid". The blockquote node was being emitted with inline text children, but the DatoCMS [structured-text spec](https://www.datocms.com/docs/structured-text/dast#blockquote) requires `Blockquote.children` to be `Paragraph[]`. The generator now wraps the blockquote body in a paragraph (`t('blockquote', t('p', s(4)))`) so the value passes validation and saves cleanly. Also tightened the `t()` helper to accept (and flatten) the deeply-nested arrays that `sentences()` produces, added an extra `toStructuredText` overload, pulled in `react-select` as a direct dependency, and corrected a few `as const`/icon types so the project type-checks again.
