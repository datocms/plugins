import type { SchemaTypes } from '@datocms/cma-client';
import { createForm } from 'final-form';
import get from 'lodash-es/get';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getVisibleExportOptions } from '@/components/ExportSelectionPanel';
import Collapsible from '@/components/SchemaOverview/Collapsible';
import {
  getEntryPage,
  PaginatedEntries,
} from '@/components/SchemaOverview/PaginatedEntries';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { sortConflictEntries } from '@/entrypoints/ImportPage/ConflictsManager';
import type { Conflicts } from '@/entrypoints/ImportPage/ConflictsManager/buildConflicts';
import {
  createResolutionValidator,
  type FormValues,
  generateReplacementIdsMutator,
  getPendingIdReplacementKeys,
} from '@/entrypoints/ImportPage/ResolutionsForm';

vi.mock('datocms-react-ui', () => ({
  Button: ({ children }: { children?: ReactNode }) =>
    createElement('button', {}, children),
  SelectField: () => null,
  SwitchInput: () => null,
}));

function model(id: string, name = id, apiKey = id): SchemaTypes.ItemType {
  return {
    id,
    type: 'item_type',
    attributes: { name, api_key: apiKey, modular_block: false },
    relationships: { fields: { data: [] }, fieldsets: { data: [] } },
  } as unknown as SchemaTypes.ItemType;
}

function conflicts(): Conflicts {
  return {
    itemTypes: {},
    plugins: {},
    ids: { itemTypes: {}, plugins: {}, fields: {}, fieldsets: {} },
    legacyIds: { itemTypes: {}, plugins: {}, fields: {}, fieldsets: {} },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe('selection and conflict rendering at schema scale', () => {
  it('bounds options and searches all models by name, API key, and ID', () => {
    const options = Array.from({ length: 1200 }, (_, index) => ({
      value: `id-${index}`,
      label: `Modèle ${index}`,
      searchText: `Modèle ${index} model_${index} id-${index}`,
    }));
    const selected = new Set(options.slice(0, 600).map(({ value }) => value));
    const all = getVisibleExportOptions(options, selected, '');
    expect(all.options).toHaveLength(100);
    expect(all.totalMatches).toBe(600);
    expect(all.options[0]?.value).toBe('id-600');
    expect(
      getVisibleExportOptions(options, selected, 'model_1199').options.map(
        ({ value }) => value,
      ),
    ).toEqual(['id-1199']);
    expect(
      getVisibleExportOptions(options, selected, 'modele 1199').totalMatches,
    ).toBe(1);
    expect(
      getVisibleExportOptions(options, selected, 'id-1199').totalMatches,
    ).toBe(1);
    expect(
      getVisibleExportOptions(options, selected, 'model_50').totalMatches,
    ).toBe(0);
  });

  it('keeps small lists intact and reaches every item in bounded large pages', () => {
    const entries = Array.from({ length: 801 }, (_, index) => index);
    expect(getEntryPage(entries.slice(0, 200), 0).entries).toHaveLength(200);
    expect(getEntryPage(entries.slice(0, 200), 0).paginated).toBe(false);
    const pages = Array.from({ length: 9 }, (_, index) =>
      getEntryPage(entries, index),
    );
    expect(pages.flatMap(({ entries: page }) => page)).toEqual(entries);
    expect(pages.every(({ entries: page }) => page.length <= 100)).toBe(true);
    expect(getEntryPage(entries, 999).entries).toEqual([800]);
    expect(getEntryPage(entries, -1).page).toBe(0);
    expect(getEntryPage(entries, Number.NaN).page).toBe(0);
    expect(getEntryPage([], 10).entries).toEqual([]);
  });

  it('sorts unresolved conflicts before resolved conflicts and names only once per row', () => {
    const entries = [
      { name: 'A normal', unresolved: false, conflict: false },
      { name: 'B resolved', unresolved: false, conflict: true },
      { name: 'Z unresolved', unresolved: true, conflict: true },
    ];
    const isUnresolved = vi.fn(
      (entry: (typeof entries)[number]) => entry.unresolved,
    );
    const getName = vi.fn((entry: (typeof entries)[number]) => entry.name);
    const result = sortConflictEntries(
      entries,
      isUnresolved,
      (entry) => entry.conflict,
      getName,
    );
    expect(result.map(({ name }) => name)).toEqual([
      'Z unresolved',
      'B resolved',
      'A normal',
    ]);
    expect(entries[0]?.name).toBe('A normal');
    expect(isUnresolved).toHaveBeenCalledTimes(entries.length);
    expect(getName).toHaveBeenCalledTimes(entries.length);
  });

  it('mounts only the current page and follows a selection outside the first page', () => {
    const entries = Array.from({ length: 1000 }, (_, index) =>
      model(`model-${index}`),
    );
    const renderEntry = vi.fn((entry: SchemaTypes.ItemType) =>
      createElement('span', { key: entry.id }, entry.id),
    );
    const listProps = { entries, children: renderEntry };
    renderToStaticMarkup(
      createElement(PaginatedEntries<SchemaTypes.ItemType>, listProps),
    );
    expect(renderEntry).toHaveBeenCalledTimes(100);
    renderEntry.mockClear();
    const selectedListProps = {
      ...listProps,
      getEntityId: (entry: SchemaTypes.ItemType) => entry.id,
    };
    renderToStaticMarkup(
      createElement(
        SelectedEntityContext.Provider,
        { value: { entity: entries[950], set: () => {} } },
        createElement(
          PaginatedEntries<SchemaTypes.ItemType>,
          selectedListProps,
        ),
      ),
    );
    expect(renderEntry).toHaveBeenCalledTimes(100);
    expect(renderEntry.mock.calls[0]?.[0].id).toBe('model-900');
  });

  it('does not mount the contents of closed accordions', () => {
    const child = vi.fn(() => createElement('span', {}, 'field controls'));
    const entity = model('model');
    const accordionProps = {
      entity,
      title: 'Model',
      children: createElement(child),
    };
    const accordion = createElement(Collapsible, accordionProps);
    expect(renderToStaticMarkup(accordion)).not.toContain('field controls');
    expect(child).not.toHaveBeenCalled();
    expect(
      renderToStaticMarkup(
        createElement(
          SelectedEntityContext.Provider,
          { value: { entity, set: () => {} } },
          accordion,
        ),
      ),
    ).toContain('field controls');
    expect(child).toHaveBeenCalledTimes(1);
  });
});

describe('complete conflict validation', () => {
  it('rejects duplicate rename destinations and clashes with unchanged imported models', async () => {
    const detected = conflicts();
    detected.itemTypes = {
      first: model('existing'),
      second: model('existing'),
    };
    const read = vi.fn(async () => [
      model('project', 'Project', 'project_key'),
    ]);
    const validate = createResolutionValidator(
      { getAllItemTypes: read },
      detected,
      [model('unchanged', 'Imported', 'imported_key')],
    );
    const duplicate = await validate({
      'itemType-first': { strategy: 'rename', name: 'New', apiKey: 'new_key' },
      'itemType-second': { strategy: 'rename', name: 'New', apiKey: 'new_key' },
    });
    for (const id of ['first', 'second']) {
      expect(get(duplicate, [`itemType-${id}`, 'name'])).toBe(
        'Already used in this import!',
      );
      expect(get(duplicate, [`itemType-${id}`, 'apiKey'])).toBe(
        'Already used in this import!',
      );
    }
    const imported = validate({
      'itemType-first': {
        strategy: 'rename',
        name: 'Imported',
        apiKey: 'imported_key',
      },
      'itemType-second': {
        strategy: 'rename',
        name: 'Project',
        apiKey: 'project_key',
      },
    });
    expect(imported).not.toBeInstanceOf(Promise);
    expect(get(imported, ['itemType-first', 'apiKey'])).toBe(
      'Already used in this import!',
    );
    expect(get(imported, ['itemType-second', 'name'])).toBe(
      'Already used in project!',
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('does not mistake Object prototype identifiers for occupied names or keys', async () => {
    const detected = conflicts();
    detected.itemTypes.first = model('existing');
    const validate = createResolutionValidator(
      { getAllItemTypes: async () => [] },
      detected,
    );
    expect(
      await validate({
        'itemType-first': {
          strategy: 'rename',
          name: 'constructor',
          apiKey: 'constructor',
        },
      }),
    ).toEqual({});
  });

  it('shares pending lookups without mixing error snapshots between rapid edits', async () => {
    const detected = conflicts();
    detected.itemTypes.first = model('existing');
    const lookup = deferred<SchemaTypes.ItemType[]>();
    const read = vi.fn(() => lookup.promise);
    const validate = createResolutionValidator(
      { getAllItemTypes: read },
      detected,
    );
    const earlier = validate({
      'itemType-first': {
        strategy: 'rename',
        name: 'Occupied',
        apiKey: 'occupied_key',
      },
    });
    const later = validate({
      'itemType-first': {
        strategy: 'rename',
        name: 'Available',
        apiKey: 'available_key',
      },
    });
    lookup.resolve([model('existing', 'Occupied', 'occupied_key')]);
    expect(get(await earlier, ['itemType-first', 'apiKey'])).toBe(
      'Already used in project!',
    );
    expect(await later).toEqual({});
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('blocks on lookup failure and automatically retries the lookup on the next validation', async () => {
    const detected = conflicts();
    detected.itemTypes.first = model('existing');
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([]);
    const validate = createResolutionValidator(
      { getAllItemTypes: read },
      detected,
    );
    const values: FormValues = {
      'itemType-first': { strategy: 'rename', name: 'New', apiKey: 'new_key' },
    };
    expect(get(await validate(values), ['itemType-first', 'apiKey'])).toContain(
      'Could not verify',
    );
    expect(await validate(values)).toEqual({});
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps Final Form valid after a later edit supersedes an async collision result', async () => {
    const detected = conflicts();
    detected.itemTypes.first = model('existing');
    const lookup = deferred<SchemaTypes.ItemType[]>();
    const validate = createResolutionValidator(
      { getAllItemTypes: () => lookup.promise },
      detected,
    );
    const form = createForm<FormValues>({
      initialValues: {
        'itemType-first': {
          strategy: 'rename',
          name: 'Occupied',
          apiKey: 'occupied_key',
        },
      },
      validate,
      onSubmit: () => {},
    });
    form.change('itemType-first', {
      strategy: 'rename',
      name: 'Available',
      apiKey: 'available_key',
    });
    const settled = new Promise<void>((resolve) => {
      form.subscribe(
        (state) => {
          if (!state.validating) resolve();
        },
        { validating: true },
      );
    });
    lookup.resolve([model('existing', 'Occupied', 'occupied_key')]);
    await settled;
    expect(form.getState().valid).toBe(true);
    expect(form.getState().errors).toEqual({});
  });

  it('keeps required and malformed rename checks synchronous', () => {
    const detected = conflicts();
    detected.itemTypes.first = model('existing');
    const read = vi.fn(async () => []);
    const validate = createResolutionValidator(
      { getAllItemTypes: read },
      detected,
    );
    const errors = validate({
      'itemType-first': {
        strategy: 'rename',
        name: '',
        apiKey: 'invalid__key',
      },
    });
    expect(errors).not.toBeInstanceOf(Promise);
    expect(get(errors, ['itemType-first', 'name'])).toBe('Required!');
    expect(get(errors, ['itemType-first', 'apiKey'])).toBe('Invalid format');
    expect(read).not.toHaveBeenCalled();
  });

  it('validates thousands of unmounted replacement fields and preserves values on unregister', () => {
    const detected = conflicts();
    const parent = model('parent');
    const values: FormValues = {};
    for (let index = 0; index < 12000; index += 1) {
      const id = `field-${index}`;
      detected.legacyIds.fields[id] = {
        entityType: 'field',
        reason: 'legacy',
        exportId: id,
        exportLabel: id,
        exportEntity: { id } as SchemaTypes.Field,
        exportParentItemType: parent,
      };
      values[`idCollision-field-${id}`] = { strategy: 'generateReplacement' };
    }
    values['idCollision-field-field-11999'] = { strategy: null };
    const validate = createResolutionValidator(
      { getAllItemTypes: async () => [] },
      detected,
    );
    expect(
      get(validate(values), ['idCollision-field-field-11999', 'strategy']),
    ).toBe('Required!');
    const form = createForm<FormValues>({
      initialValues: values,
      validate,
      onSubmit: () => {},
      destroyOnUnregister: false,
    });
    const unregister = form.registerField(
      'idCollision-field-field-1.strategy',
      () => {},
      { value: true },
    );
    unregister();
    expect(
      get(form.getState().values, ['idCollision-field-field-1', 'strategy']),
    ).toBe('generateReplacement');
    expect(form.getState().valid).toBe(false);
    form.change('idCollision-field-field-11999', {
      strategy: 'generateReplacement',
    });
    expect(form.getState().valid).toBe(true);
  });

  it('ignores child replacement errors only when the parent is explicitly reused', () => {
    const detected = conflicts();
    const parent = model('parent');
    detected.itemTypes.parent = parent;
    detected.legacyIds.fields.field = {
      entityType: 'field',
      reason: 'legacy',
      exportId: 'field',
      exportLabel: 'Field',
      exportEntity: { id: 'field' } as SchemaTypes.Field,
      exportParentItemType: parent,
    };
    const validate = createResolutionValidator(
      { getAllItemTypes: async () => [] },
      detected,
    );
    expect(
      validate({ 'itemType-parent': { strategy: 'reuseExisting' } }),
    ).toEqual({});
    expect(get(validate({}), ['idCollision-field-field', 'strategy'])).toBe(
      'Required!',
    );
  });

  it('resolves every pending ID in one validation while preserving reuse and skip decisions', () => {
    const detected = conflicts();
    const parent = model('parent');
    const reusedParent = model('reused');
    detected.itemTypes.reused = reusedParent;
    const values: FormValues = {
      'itemType-reused': { strategy: 'reuseExisting' },
      'plugin-skipped': { strategy: 'skip' },
    };
    for (let index = 0; index < 3000; index += 1) {
      const id = `field-${index}`;
      detected.legacyIds.fields[id] = {
        entityType: 'field',
        reason: 'legacy',
        exportId: id,
        exportLabel: id,
        exportEntity: { id } as SchemaTypes.Field,
        exportParentItemType: parent,
      };
      values[`idCollision-field-${id}`] = { strategy: null };
    }
    detected.legacyIds.fields.inactive = {
      entityType: 'field',
      reason: 'legacy',
      exportId: 'inactive',
      exportLabel: 'Inactive',
      exportEntity: { id: 'inactive' } as SchemaTypes.Field,
      exportParentItemType: reusedParent,
    };
    detected.legacyIds.plugins.skipped = {
      entityType: 'plugin',
      reason: 'legacy',
      exportId: 'skipped',
      exportLabel: 'Skipped',
      exportEntity: { id: 'skipped' } as SchemaTypes.Plugin,
    };
    values['idCollision-field-field-0'] = { strategy: 'generateReplacement' };
    const pending = getPendingIdReplacementKeys(detected, values);
    expect(pending).toHaveLength(2999);
    expect(pending).not.toContain('idCollision-field-inactive');
    expect(pending).not.toContain('idCollision-plugin-skipped');
    const validate = vi.fn(
      createResolutionValidator({ getAllItemTypes: async () => [] }, detected),
    );
    const form = createForm<FormValues>({
      initialValues: values,
      validate,
      onSubmit: () => {},
      mutators: { generateReplacementIds: generateReplacementIdsMutator },
    });
    validate.mockClear();
    form.mutators.generateReplacementIds(pending);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(form.getState().valid).toBe(true);
    expect(
      get(form.getState().values, ['idCollision-field-field-2999', 'strategy']),
    ).toBe('generateReplacement');
    expect(form.getState().values?.['itemType-reused']).toEqual({
      strategy: 'reuseExisting',
    });
    expect(form.getState().values?.['plugin-skipped']).toEqual({
      strategy: 'skip',
    });
    expect(values['idCollision-field-field-2999']).toEqual({ strategy: null });
  });
});
