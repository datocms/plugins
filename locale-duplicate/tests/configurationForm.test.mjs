import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getVisibleOptions } from '../src/utils/selection.ts';

registerHooks({
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

// Capture the public SelectField props while still rendering its real implementation.
const uiRequire = createRequire(import.meta.url);
const uiEntry = uiRequire.resolve('datocms-react-ui');
const selectFieldModule = uiRequire(
  join(dirname(uiEntry), 'SelectField/index.js'),
);
const originalSelectField = selectFieldModule.SelectField;
let renderedSelectFields = [];
selectFieldModule.SelectField = (props) => {
  renderedSelectFields.push(props);
  return createElement(originalSelectField, props);
};
const { ConfigurationForm } = await import(
  '../src/components/ConfigurationForm/ConfigurationForm.tsx'
);

const allModels = Array.from({ length: 1_000 }, (_, index) => ({
  value: `model-${index}`,
  label: `Model ${index}`,
}));

function renderConfiguration(selectedModels) {
  renderedSelectFields = [];
  const markup = renderToStaticMarkup(
    createElement(ConfigurationForm, {
      sourceLocale: 'en',
      targetLocale: 'pt',
      currentSiteLocales: ['en', 'pt'],
      selectedModels,
      allModels,
      useDraftRecords: false,
      publishAfterDuplication: false,
      getLocaleLabel: (locale) => locale,
      onSourceLocaleChange() {},
      onTargetLocaleChange() {},
      onModelsChange() {},
      onUseDraftRecordsChange() {},
      onPublishAfterDuplicationChange() {},
      onSubmit() {},
    }),
  );
  const modelField = renderedSelectFields.find(
    (field) => field.id === 'models',
  );
  assert.ok(modelField);
  return { markup, modelField };
}

test('up to 50 selected models retain the existing removable chips', () => {
  const selected = allModels.slice(0, 50);
  const { markup, modelField } = renderConfiguration(selected);
  assert.equal((markup.match(/aria-label="Remove Model /g) ?? []).length, 50);
  assert.equal(modelField.value, selected);
  assert.equal(modelField.selectInputProps.controlShouldRenderValue, undefined);
  assert.equal(modelField.selectInputProps.hideSelectedOptions, undefined);
  assert.equal(modelField.selectInputProps.options.length, 100);
  assert.equal(modelField.selectInputProps.options[0], allModels[50]);
});

test('more than 50 selected models show a compact count without rendering chips', () => {
  const selected = allModels.slice(0, 51);
  const { markup, modelField } = renderConfiguration(selected);
  assert.equal((markup.match(/aria-label="Remove Model /g) ?? []).length, 0);
  assert.match(markup, /51 models selected\.\.\./);
  assert.equal(modelField.value, selected);
  assert.equal(modelField.selectInputProps.controlShouldRenderValue, false);
  assert.equal(modelField.selectInputProps.hideSelectedOptions, false);
  assert.equal(modelField.selectInputProps.options[0], allModels[0]);
});

test('the installed react-select removes a searched selected model while preserving all others', () => {
  const { modelField } = renderConfiguration(allModels);
  const dependencyRequire = createRequire(uiEntry);
  const selectDirectory = dirname(dependencyRequire.resolve('react-select'));
  const selectModule = readdirSync(selectDirectory).find(
    (name) => name.startsWith('Select-') && name.endsWith('.cjs.dev.js'),
  );
  assert.ok(
    selectModule,
    'the installed react-select implementation is available',
  );
  const { Select } = dependencyRequire(join(selectDirectory, selectModule));
  let changed;
  let action;
  const instance = new Select({
    ...Select.defaultProps,
    ...modelField.selectInputProps,
    options: getVisibleOptions(allModels, 'Model 999'),
    value: modelField.value,
    menuIsOpen: true,
    inputValue: '',
    onInputChange() {},
    onMenuClose() {},
    onChange(next, meta) {
      changed = next;
      action = meta.action;
    },
  });
  instance.setState = (update) => {
    const next =
      typeof update === 'function'
        ? update(instance.state, instance.props)
        : update;
    instance.state = { ...instance.state, ...next };
  };
  const options = instance.getCategorizedOptions();
  assert.equal(options.length, 1);
  assert.equal(options[0].isSelected, true);
  instance.selectOption(allModels[999]);
  assert.equal(action, 'deselect-option');
  assert.equal(changed.length, 999);
  assert.equal(changed.includes(allModels[999]), false);
  assert.equal(changed[0], allModels[0]);
  assert.equal(changed[998], allModels[998]);
  assert.equal(allModels.length, 1_000);
});
