import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetReactUi, uiProps } from './reactUiStub.mjs';

const { ConfigurationForm, duplicateDisabledReason } = await import(
  '../src/components/ConfigurationForm/ConfigurationForm.tsx'
);
const { formatters } = await import('../src/utils/format.ts');
const { getVisibleOptions } = await import('../src/utils/selection.ts');

const allModels = Array.from({ length: 1_000 }, (_, index) => ({
  value: `model-${index}`,
  label: `Model ${index}`,
}));

// Renders the form and returns the props it gives the models select
function renderModelsSelect(selectedModels, onModelsChange = () => {}) {
  resetReactUi();
  renderToStaticMarkup(
    createElement(ConfigurationForm, {
      sourceLocale: 'en',
      targetLocale: 'pt',
      currentSiteLocales: ['en', 'pt'],
      selectedModels,
      allModels,
      modelsState: 'loaded',
      modelsError: '',
      useDraftRecords: false,
      publishAfterDuplication: false,
      format: formatters('en'),
      getLocaleLabel: (locale) => locale,
      onSourceLocaleChange() {},
      onTargetLocaleChange() {},
      onModelsChange,
      onUseDraftRecordsChange() {},
      onPublishAfterDuplicationChange() {},
      onSubmit() {},
    }),
  );
  const modelsSelect = uiProps('SelectInput').find((props) => props.multiple);
  assert.ok(modelsSelect);
  return modelsSelect;
}

test('up to 50 selected models keep the pills and every hidden selection', () => {
  const selected = allModels.slice(0, 50);
  const select = renderModelsSelect(selected);
  assert.deepEqual(
    select.value,
    selected.map((model) => model.value),
  );
  assert.equal(select.controlShouldRenderValue, undefined);
  assert.equal(select.hideSelectedOptions, undefined);
  assert.equal(select.placeholder, undefined);
  assert.equal(select.options.length, 100);
  assert.equal(select.options[0], allModels[50]);
  for (const model of selected) {
    assert.equal(select.acceptValueNotIncludedInOptions(model.value), model);
  }
});

test('more than 50 selected models show a count instead of pills', () => {
  const select = renderModelsSelect(allModels.slice(0, 51));
  assert.equal(select.controlShouldRenderValue, false);
  assert.equal(select.hideSelectedOptions, false);
  assert.equal(select.placeholder, '51 models selected');
  assert.equal(select.options[0], allModels[0]);
});

test('deselecting a searched model in compact mode keeps the other 999 in order', () => {
  let changedModels;
  const select = renderModelsSelect(allModels, (models) => {
    changedModels = models;
  });

  // The react-select that the installed SelectInput renders
  const uiRequire = createRequire(
    createRequire(import.meta.url).resolve(
      '../node_modules/datocms-react-ui/dist/SelectInput.js',
    ),
  );
  const selectDirectory = dirname(uiRequire.resolve('react-select'));
  const selectModule = readdirSync(selectDirectory).find(
    (name) => name.startsWith('Select-') && name.endsWith('.cjs.dev.js'),
  );
  assert.ok(selectModule, 'the installed react-select is available');
  const { Select } = uiRequire(join(selectDirectory, selectModule));

  // The options and the value as SelectInput's adapter builds them
  const options = getVisibleOptions(allModels, 'Model 999');
  const value = select.value.map(
    (id) =>
      options.find((option) => option.value === id) ??
      select.acceptValueNotIncludedInOptions(id),
  );
  assert.equal(value.length, 1_000);

  let action;
  const instance = new Select({
    ...Select.defaultProps,
    isMulti: true,
    controlShouldRenderValue: select.controlShouldRenderValue,
    hideSelectedOptions: select.hideSelectedOptions,
    options,
    value,
    menuIsOpen: true,
    inputValue: '',
    onInputChange() {},
    onMenuClose() {},
    onChange(next, meta) {
      action = meta.action;
      select.onChange(
        next.map((option) => option.value),
        next,
      );
    },
  });
  instance.setState = (update) => {
    const next =
      typeof update === 'function'
        ? update(instance.state, instance.props)
        : update;
    instance.state = { ...instance.state, ...next };
  };
  const categorized = instance.getCategorizedOptions();
  assert.equal(categorized.length, 1);
  assert.equal(categorized[0].isSelected, true);
  instance.selectOption(allModels[999]);

  assert.equal(action, 'deselect-option');
  assert.equal(changedModels.length, 999);
  assert.equal(changedModels.includes(allModels[999]), false);
  assert.equal(changedModels[0], allModels[0]);
  assert.equal(changedModels[998], allModels[998]);
});

test('Duplicate explains why it is disabled', () => {
  const ready = {
    sourceLocale: 'en',
    targetLocale: 'it',
    siteLocales: ['en', 'it'],
    selectedCount: 3,
    modelsState: 'loaded',
  };
  assert.equal(duplicateDisabledReason(ready), undefined);
  assert.equal(
    duplicateDisabledReason({
      ...ready,
      siteLocales: ['en'],
      targetLocale: 'en',
    }),
    'The project has only one locale.',
  );
  assert.equal(
    duplicateDisabledReason({ ...ready, targetLocale: 'en' }),
    'Pick two different locales.',
  );
  assert.equal(
    duplicateDisabledReason({ ...ready, targetLocale: 'de' }),
    'Pick two different locales.',
  );
  assert.equal(
    duplicateDisabledReason({ ...ready, modelsState: 'loading' }),
    'Wait for the models to load.',
  );
  assert.equal(
    duplicateDisabledReason({ ...ready, modelsState: 'failed' }),
    "The models couldn't load.",
  );
  assert.equal(
    duplicateDisabledReason({ ...ready, selectedCount: 0 }),
    'Pick at least one model.',
  );
});
