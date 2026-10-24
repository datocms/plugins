import type { SchemaTypes } from '@datocms/cma-client';
import { createForm } from 'final-form';
import get from 'lodash-es/get';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OverviewItem } from '@/components/SchemaOverview/OverviewItem';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { sortConflictEntries } from '@/entrypoints/ImportPage/ConflictsManager';
import type { Conflicts } from '@/entrypoints/ImportPage/ConflictsManager/buildConflicts';
import {
  createResolutionValidator,
  type FormValues,
  generateReplacementIdsMutator,
  getPendingIdReplacementKeys,
} from '@/entrypoints/ImportPage/ResolutionsForm';

// The components of datocms-react-ui need a Canvas: the modules under test
// get stubs that render their texts and children. The list covers what the
// overview, the conflicts manager and the resolutions form import.
const reactUi = vi.hoisted(() => ({
  async stub(parts: string[] = [], named?: string) {
    const { createElement, Fragment } = await import('react');
    type StubProps = { children?: ReactNode; label?: unknown; title?: unknown };
    // A component with its parts (Pane.Header.Title) as properties
    type Stub = ((props: StubProps) => ReactNode) & { [part: string]: Stub };
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    const make = (): Stub => {
      const component = ({ children, label, title }: StubProps) =>
        createElement(Fragment, {}, text(title), text(label), children);
      return Object.assign(component, {} as Record<string, Stub>);
    };
    const root = make();
    for (const path of parts) {
      let parent = root;
      for (const part of path.split('.')) {
        parent[part] ??= make();
        parent = parent[part];
      }
    }
    return {
      default: root,
      ...(named ? { [named]: root } : {}),
      useFilteredList: vi.fn(),
      useCtx: () => ({ colorScheme: 'light' }),
    };
  },
}));

vi.mock('datocms-react-ui/ApiKey', () => reactUi.stub());
vi.mock('datocms-react-ui/BlankSlate', () => reactUi.stub());
vi.mock('datocms-react-ui/Button', () => reactUi.stub());
vi.mock('datocms-react-ui/Callout', () => reactUi.stub());
vi.mock('datocms-react-ui/Canvas', () => reactUi.stub());
vi.mock('datocms-react-ui/Dropdown', () =>
  reactUi.stub(['Menu', 'Option', 'Separator'], 'Dropdown'),
);
vi.mock('datocms-react-ui/FieldWrapper', () => reactUi.stub());
vi.mock('datocms-react-ui/IdText', () => reactUi.stub());
vi.mock('datocms-react-ui/Main', () => reactUi.stub());
vi.mock('datocms-react-ui/Pane', () =>
  reactUi.stub([
    'Header',
    'Header.Title',
    'Header.Subtitle',
    'Header.Menu',
    'FilterBlankSlate',
  ]),
);
vi.mock('datocms-react-ui/Pill', () => reactUi.stub());
vi.mock('datocms-react-ui/RadioGroupInput', () => reactUi.stub());
vi.mock('datocms-react-ui/SplitPane', () => reactUi.stub());
vi.mock('datocms-react-ui/StringInput', () => reactUi.stub());
vi.mock('datocms-react-ui/SwitchInput', () => reactUi.stub());
vi.mock('datocms-react-ui/SwitchList', () => reactUi.stub());
vi.mock('datocms-react-ui/Toolbar', () =>
  reactUi.stub([
    'Button',
    'GoBack',
    'Help',
    'Pagination',
    'Space',
    'Spinner',
    'Subtitle',
    'Title',
  ]),
);
vi.mock('datocms-react-ui/Tooltip', () => reactUi.stub());

// A CardList item renders its summary and its body: the item decides whether
// its body mounts.
vi.mock('datocms-react-ui/CardList', async () => {
  const { createElement } = await import('react');
  type ItemProps = {
    row?: { summary?: ReactNode; trailing?: ReactNode };
    body?: ReactNode;
    expandable?: { body?: ReactNode };
  };
  const Item = ({ row, body, expandable }: ItemProps) =>
    createElement(
      'li',
      {},
      row?.summary,
      row?.trailing,
      expandable?.body ?? body,
    );
  const CardList = ({ children }: { children?: ReactNode }) =>
    createElement('ul', {}, children);
  return { default: Object.assign(CardList, { Item }) };
});

vi.mock('datocms-react-ui/EntityRow', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ title, children }: { title?: unknown; children?: ReactNode }) =>
      createElement(
        'span',
        {},
        typeof title === 'string' ? title : null,
        children,
      ),
  };
});

// The conflict items are not under test here: their stubs keep the imports
// of the review screen out of this file.
vi.mock('@/entrypoints/ImportPage/ConflictsManager/ItemTypeConflict', () => ({
  ItemTypeConflict: () => null,
}));
vi.mock('@/entrypoints/ImportPage/ConflictsManager/PluginConflict', () => ({
  PluginConflict: () => null,
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

describe('conflict list rendering', () => {
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

  it('does not mount the contents of closed accordions', () => {
    const child = vi.fn(() => createElement('span', {}, 'field controls'));
    const entity = model('model');
    // The body comes as the third argument, as JSX gives it
    const props = { entity } as Parameters<typeof OverviewItem>[0];
    const item = createElement(OverviewItem, props, createElement(child));
    expect(renderToStaticMarkup(item)).not.toContain('field controls');
    expect(child).not.toHaveBeenCalled();
    expect(
      renderToStaticMarkup(
        createElement(
          SelectedEntityContext.Provider,
          { value: { entity, set: () => {} } },
          item,
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
        'Another model or block of this import uses it.',
      );
      expect(get(duplicate, [`itemType-${id}`, 'apiKey'])).toBe(
        'Another model or block of this import uses it.',
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
      'Another model or block of this import uses it.',
    );
    expect(get(imported, ['itemType-second', 'name'])).toBe(
      'A model or block of the project uses it.',
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
      'A model or block of the project uses it.',
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
    expect(get(await validate(values), ['itemType-first', 'apiKey'])).toBe(
      'The API keys of the project could not be checked. Edit the value to check again.',
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
    expect(get(errors, ['itemType-first', 'name'])).toBe('Enter a name.');
    expect(get(errors, ['itemType-first', 'apiKey'])).toBe(
      'Not a valid API key: use lowercase letters, numbers and single underscores, starting with a letter.',
    );
    expect(read).not.toHaveBeenCalled();
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
      'A new ID is needed to import it.',
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
    for (let index = 0; index < 5; index += 1) {
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
    expect(pending).toHaveLength(4);
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
      get(form.getState().values, ['idCollision-field-field-4', 'strategy']),
    ).toBe('generateReplacement');
    expect(form.getState().values?.['itemType-reused']).toEqual({
      strategy: 'reuseExisting',
    });
    expect(form.getState().values?.['plugin-skipped']).toEqual({
      strategy: 'skip',
    });
    expect(values['idCollision-field-field-4']).toEqual({ strategy: null });
  });
});
