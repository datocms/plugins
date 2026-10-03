import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Render the actual component with persistent refs, and control its async gaps.
// Host UI is inert; JSX creation and the rest of the React runtime remain real.
let activeHooks;
globalThis.localeCopyTestHooks = {
  useRef(initial) {
    const index = activeHooks.cursor++;
    activeHooks.refs[index] ??= { current: initial };
    return activeHooks.refs[index];
  },
  useCallback(callback) {
    return callback;
  },
  useState(initial) {
    return [initial, () => {}];
  },
};

const hookSource = `
  export const { useRef, useCallback, useState } = globalThis.localeCopyTestHooks;
`;
const uiSource = 'export function Button() {} export function Canvas() {}';
const hooksUrl = `data:text/javascript,${encodeURIComponent(hookSource)}`;
const uiUrl = `data:text/javascript,${encodeURIComponent(uiSource)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === 'react' &&
      context.parentURL.endsWith('/entrypoints/FieldExtension.tsx')
    )
      return { url: hooksUrl, shortCircuit: true };
    if (specifier === 'datocms-react-ui')
      return { url: uiUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('data:text/javascript,'))
      return {
        format: 'module',
        shortCircuit: true,
        source: decodeURIComponent(url.slice('data:text/javascript,'.length)),
      };
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default {};',
      };
    return nextLoad(url, context);
  },
});

const { default: FieldExtension } = await import(
  '../src/entrypoints/FieldExtension.tsx'
);

function harness() {
  const hooks = { refs: [], cursor: 0 };
  const writes = [];
  const alerts = [];
  const notices = [];
  const context = (overrides = {}) => ({
    item: { id: 'record-A' },
    itemType: { id: 'record-model' },
    site: { id: 'site' },
    environment: 'main',
    cmaBaseUrl: 'https://example.test',
    fieldPath: 'title.en',
    locale: 'en',
    formValues: {
      internalLocales: ['en', 'pt', 'fr'],
      title: { en: 'Source from A', pt: 'Existing', fr: 'Existing' },
    },
    field: {
      id: 'field',
      attributes: { api_key: 'title', localized: true, field_type: 'string' },
    },
    disabled: false,
    isSubmitting: false,
    notice(message) {
      notices.push(message);
    },
    async alert(message) {
      alerts.push(message);
    },
    async setFieldValue(path, value) {
      writes.push({ recordId: this.item?.id, path, value });
    },
    ...overrides,
  });
  const render = (ctx) => {
    activeHooks = hooks;
    hooks.cursor = 0;
    const element = FieldExtension({ ctx });
    return element?.props.children.props.children.props;
  };
  return { render, context, writes, alerts, notices };
}

test('a record change during the async gap never receives the previous source', async () => {
  const host = harness();
  const pending = host.render(host.context()).onClick();
  host.render(host.context({ item: { id: 'record-B' } }));
  await pending;
  assert.deepEqual(host.writes, []);
  assert.match(host.alerts[0], /copied to 0 of 2 locales/);
  assert.match(host.alerts[0], /editing context changed/);
});

test('each available SDK identity is checked even when field path and locale stay the same', async () => {
  const changes = [
    { site: { id: 'other-site' } },
    { environment: 'sandbox' },
    { cmaBaseUrl: 'https://other.example.test' },
    { itemType: { id: 'other-model' } },
    { item: null },
    {
      field: {
        id: 'other-field',
        attributes: { api_key: 'title', localized: true, field_type: 'string' },
      },
    },
    { block: { id: 'other-block', blockModel: { id: 'block-model' } } },
    { fieldPath: 'other.en' },
    { locale: 'pt' },
  ];
  for (const change of changes) {
    const host = harness();
    const pending = host.render(host.context()).onClick();
    host.render(host.context(change));
    // biome-ignore lint/performance/noAwaitInLoops: settle one isolated component before the next harness.
    await pending;
    assert.deepEqual(host.writes, [], JSON.stringify(change));
    assert.match(host.alerts[0], /editing context changed/);
  }
});

test('a different persisted block at the same path is rejected', async () => {
  const host = harness();
  const initial = host.context({
    block: { id: 'block-A', blockModel: { id: 'block-model' } },
  });
  const pending = host.render(initial).onClick();
  host.render({
    ...initial,
    block: { id: 'block-B', blockModel: { id: 'block-model' } },
  });
  await pending;
  assert.deepEqual(host.writes, []);
});

test('a temporary Structured Text block key protects an unsaved block', async () => {
  const host = harness();
  const initial = host.context({
    block: { id: undefined, blockModel: { id: 'block-model' } },
    fieldPath: 'body.en.0.title.en',
    formValues: {
      internalLocales: ['en', 'pt'],
      body: {
        en: [
          { type: 'block', key: 'block-A', title: { en: 'Source', pt: '' } },
        ],
      },
    },
  });
  const pending = host.render(initial).onClick();
  host.render({
    ...initial,
    formValues: {
      ...initial.formValues,
      body: {
        en: [{ type: 'block', key: 'block-B', title: { en: 'Other', pt: '' } }],
      },
    },
  });
  await pending;
  assert.deepEqual(host.writes, []);
});

test('replacing an unidentified new modular block never receives the previous source', async () => {
  const host = harness();
  const initial = host.context({
    block: { id: undefined, blockModel: { id: 'block-model' } },
    fieldPath: 'body.en[0].title.en',
    formValues: {
      internalLocales: ['en', 'pt'],
      body: {
        en: [{ itemTypeId: 'block-model', title: { en: 'Source', pt: '' } }],
      },
    },
  });
  const pending = host.render(initial).onClick();
  host.render({
    ...initial,
    formValues: {
      ...initial.formValues,
      body: {
        en: [{ itemTypeId: 'block-model', title: { en: 'Other', pt: '' } }],
      },
    },
  });
  await pending;
  assert.deepEqual(host.writes, []);
  assert.match(host.alerts[0], /editing context changed/);
});

test('a modular editor itemId detects replacement even when source values match', async () => {
  const host = harness();
  const block = (itemId) => ({
    itemId,
    itemTypeId: 'block-model',
    title: { en: 'Same source', pt: '' },
  });
  const initial = host.context({
    block: { id: undefined, blockModel: { id: 'block-model' } },
    fieldPath: 'body.en.0.title.en',
    formValues: {
      internalLocales: ['en', 'pt'],
      body: { en: [block('temporary-A')] },
    },
  });
  const pending = host.render(initial).onClick();
  host.render({
    ...initial,
    formValues: { ...initial.formValues, body: { en: [block('temporary-B')] } },
  });
  await pending;
  assert.deepEqual(host.writes, []);
  assert.match(host.alerts[0], /editing context changed/);
});

test('new modular blocks keep fan-out when form snapshots update after each write', async () => {
  const host = harness();
  let current = host.context({
    block: { id: undefined, blockModel: { id: 'block-model' } },
    fieldPath: 'body.en.0.title.en',
    formValues: {
      internalLocales: ['en', 'pt', 'fr'],
      body: {
        en: [
          { itemTypeId: 'block-model', title: { en: 'Source', pt: '', fr: '' } },
        ],
      },
    },
  });
  current.setFieldValue = async (path, value) => {
    host.writes.push({ path, value });
    const locale = path.split('.').at(-1);
    const block = current.formValues.body.en[0];
    current = {
      ...current,
      formValues: {
        ...current.formValues,
        body: {
          en: [{ ...block, title: { ...block.title, [locale]: value } }],
        },
      },
    };
    host.render(current);
  };
  await host.render(current).onClick();
  assert.deepEqual(host.writes, [
    { path: 'body.en.0.title.pt', value: 'Source' },
    { path: 'body.en.0.title.fr', value: 'Source' },
  ]);
  assert.deepEqual(host.alerts, []);
  assert.deepEqual(host.notices, ['Value copied to all locales']);
});

test('context changes after the first write prevent all later locale writes', async () => {
  const host = harness();
  const initial = host.context();
  initial.setFieldValue = async (path, value) => {
    host.writes.push({ path, value });
    host.render(host.context({ item: { id: 'record-B' } }));
  };
  await host.render(initial).onClick();
  assert.deepEqual(host.writes, [{ path: 'title.pt', value: 'Source from A' }]);
  assert.match(host.alerts[0], /copied to 1 of 2 locales/);
  assert.match(host.alerts[0], /editing context changed/);
});

test('removing a target locale during the first write does not reintroduce it', async () => {
  const host = harness();
  const initial = host.context();
  initial.setFieldValue = async (path, value) => {
    host.writes.push({ path, value });
    host.render({
      ...initial,
      formValues: { ...initial.formValues, internalLocales: ['en', 'pt'] },
    });
  };
  await host.render(initial).onClick();
  assert.deepEqual(host.writes, [{ path: 'title.pt', value: 'Source from A' }]);
  assert.match(host.alerts[0], /copied to 1 of 2 locales/);
  assert.match(host.alerts[0], /locale is no longer available/);
});

test('removing the source locale before the first write prevents every write', async () => {
  const host = harness();
  const initial = host.context();
  const pending = host.render(initial).onClick();
  host.render({
    ...initial,
    formValues: { ...initial.formValues, internalLocales: ['pt', 'fr'] },
  });
  await pending;
  assert.deepEqual(host.writes, []);
  assert.match(host.alerts[0], /locale is no longer available/);
});

test('new records keep their fan-out when their form snapshot updates after each write', async () => {
  const host = harness();
  let current = host.context({ item: null });
  current.setFieldValue = async (path, value) => {
    host.writes.push({ path, value });
    const locale = path.split('.').at(-1);
    current = {
      ...current,
      formValues: {
        ...current.formValues,
        internalLocales: [...current.formValues.internalLocales, 'de'],
        title: { ...current.formValues.title, [locale]: value },
      },
    };
    host.render(current);
  };
  await host.render(current).onClick();
  assert.deepEqual(host.writes, [
    { path: 'title.pt', value: 'Source from A' },
    { path: 'title.fr', value: 'Source from A' },
  ]);
  assert.deepEqual(host.alerts, []);
  assert.deepEqual(host.notices, ['Value copied to all locales']);
});
