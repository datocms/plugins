import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialDuplicationStats } from '../src/services/duplicationTypes.ts';

// Exercise our actual components with lightweight host UI/CSS stand-ins.
const reactUrl = new URL('../node_modules/react/index.js', import.meta.url)
  .href;
const uiSource = `
  import { createElement } from ${JSON.stringify(reactUrl)};
  export function Button({ children, disabled, onClick }) {
    return createElement('button', { disabled, onClick }, children);
  }
  export function Section({ children, title }) {
    return createElement('section', null, createElement('h2', null, title), children);
  }
  export function Spinner() { return createElement('span', null, 'Loading'); }
`;
const uiUrl = `data:text/javascript,${encodeURIComponent(uiSource)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'datocms-react-ui')
      return { url: uiUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css')) {
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export default new Proxy({}, { get: (_target, key) => String(key) });',
      };
    }
    return nextLoad(url, context);
  },
});

const {
  completedWithoutErrors,
  OverallSummary,
  RecordStatistics,
  SummaryView,
} = await import('../src/components/SummaryView/SummaryView.tsx');
const { progressUpdateKey } = await import(
  '../src/components/ProgressView/ProgressView.tsx'
);

function renderSummary(overrides = {}) {
  return renderToStaticMarkup(
    createElement(SummaryView, {
      duplicationStats: initialDuplicationStats(),
      progressUpdates: [],
      errorUpdates: [],
      errorCount: 0,
      operationCount: 0,
      onReturn() {},
      ...overrides,
    }),
  );
}

test('a healthy zero-record/no-op run is successful and has no 100% failed statistic', () => {
  const stats = initialDuplicationStats();
  assert.equal(completedWithoutErrors(stats, 0), true);
  assert.match(renderSummary(), /Duplication Completed Successfully/);
  const records = renderToStaticMarkup(
    createElement(RecordStatistics, { duplicationStats: stats }),
  );
  assert.doesNotMatch(records, /100%/);
  assert.match(records, /✗ Failed<\/td><td>0<\/td><td>0%/);
});

test('an exception before the first stats snapshot is never shown as successful', () => {
  const earlyError = {
    message: 'Synthetic initialization failure',
    type: 'error',
    timestamp: 1,
  };
  const sampled = renderSummary({ errorUpdates: [earlyError] });
  assert.match(sampled, /Duplication Completed with Errors/);
  assert.match(sampled, /Errors Encountered/);
  assert.doesNotMatch(sampled, /Completed Successfully/);
  assert.doesNotMatch(
    renderSummary({ errorCount: 1 }),
    /Completed Successfully/,
  );
});

test('failed, pending, incomplete, and cancelled runs cannot show green success', () => {
  for (const field of [
    'failedRecords',
    'failedPublications',
    'pendingPublications',
    'modelFailures',
    'totalToProcess',
  ]) {
    const stats = { ...initialDuplicationStats(), [field]: 1 };
    assert.equal(completedWithoutErrors(stats, 0), false, field);
    assert.doesNotMatch(
      renderSummary({ duplicationStats: stats }),
      /Completed Successfully/,
    );
  }
  const cancelled = { ...initialDuplicationStats(), cancelled: true };
  assert.equal(completedWithoutErrors(cancelled, 0), false);
  assert.match(
    renderSummary({ duplicationStats: cancelled }),
    /Duplication Aborted/,
  );
});

test('summary retains confirmed publication counts and pending outcomes', () => {
  const stats = {
    ...initialDuplicationStats(),
    totalRecords: 20,
    totalToProcess: 30,
    publishedRecords: 10,
    failedPublications: 2,
    pendingPublications: 5,
    cancelled: true,
  };
  const markup = renderToStaticMarkup(
    createElement(OverallSummary, {
      duplicationStats: stats,
      errorCount: 0,
    }),
  );
  assert.match(
    markup,
    /10 records published; 2 publication failures; 5 pending/,
  );
  assert.match(markup, /10 selected records were not processed/);
  assert.match(markup, /Duplication Aborted/);
});

test('distinct log events with identical timestamps/messages have stable unique keys', () => {
  const first = { message: 'Repeated status', type: 'info', timestamp: 1 };
  const second = { ...first };
  assert.notEqual(progressUpdateKey(first), progressUpdateKey(second));
  assert.equal(progressUpdateKey(first), progressUpdateKey(first));
});
