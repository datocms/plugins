import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialDuplicationStats } from '../src/services/duplicationTypes.ts';
import { resetReactUi, uiProps } from './reactUiStub.mjs';

// Exercise the actual component with the shared react-ui stand-ins.
const { completedWithoutErrors, SummaryView } = await import(
  '../src/components/SummaryView/SummaryView.tsx'
);
const { progressUpdateKey } = await import('../src/utils/progressLog.ts');
const { formatters } = await import('../src/utils/format.ts');

function renderSummary(overrides = {}) {
  resetReactUi();
  return renderToStaticMarkup(
    createElement(SummaryView, {
      duplicationStats: initialDuplicationStats(),
      progressUpdates: [],
      errorUpdates: [],
      errorCount: 0,
      operationCount: 0,
      format: formatters('en'),
      onReturn() {},
      ...overrides,
    }),
  );
}

const outcome = () => uiProps('Callout')[0];
const groupTitles = () => uiProps('Page.Group').map((group) => group.title);
const results = () =>
  Object.fromEntries(
    uiProps('InfoList.Row').map((row) => [row.title, row.children]),
  );

test('a healthy empty run is complete and never shows 100% failed', () => {
  const stats = initialDuplicationStats();
  assert.equal(completedWithoutErrors(stats, 0), true);
  const markup = renderSummary();
  assert.equal(outcome().tone, 'success');
  assert.equal(outcome().title, 'Duplication complete');
  assert.equal(results().Failed, '0 (0%)');
  assert.doesNotMatch(markup, /100%/);
});

test('an error before the first stats snapshot is never a success', () => {
  const earlyError = {
    message: 'Synthetic initialization failure',
    type: 'error',
    timestamp: 1,
  };
  renderSummary({ errorUpdates: [earlyError] });
  assert.equal(outcome().title, 'Duplication finished with errors');
  assert.ok(groupTitles().includes('Errors'));
  renderSummary({ errorCount: 1 });
  assert.notEqual(outcome().tone, 'success');
});

test('failed, pending, incomplete and cancelled runs are never a success', () => {
  for (const field of [
    'failedRecords',
    'failedPublications',
    'pendingPublications',
    'modelFailures',
    'totalToProcess',
  ]) {
    const stats = { ...initialDuplicationStats(), [field]: 1 };
    assert.equal(completedWithoutErrors(stats, 0), false, field);
    renderSummary({ duplicationStats: stats });
    assert.notEqual(outcome().tone, 'success', field);
  }
  const cancelled = { ...initialDuplicationStats(), cancelled: true };
  assert.equal(completedWithoutErrors(cancelled, 0), false);
  renderSummary({ duplicationStats: cancelled });
  assert.equal(outcome().title, 'Duplication stopped');
});

test('the results show the publication and not processed counts', () => {
  renderSummary({
    duplicationStats: {
      ...initialDuplicationStats(),
      totalRecords: 20,
      totalToProcess: 30,
      publishedRecords: 10,
      failedPublications: 2,
      pendingPublications: 5,
      cancelled: true,
    },
  });
  const rows = results();
  assert.equal(rows.Published, '10');
  assert.equal(rows['Publication failures'], '2');
  assert.equal(rows['Pending publication'], '5');
  assert.equal(rows['Not processed'], '10');
  assert.equal(outcome().title, 'Duplication stopped');
});

test('distinct log events with identical timestamps and messages have stable unique keys', () => {
  const first = { message: 'Repeated status', type: 'info', timestamp: 1 };
  const second = { ...first };
  assert.notEqual(progressUpdateKey(first), progressUpdateKey(second));
  assert.equal(progressUpdateKey(first), progressUpdateKey(first));
});
