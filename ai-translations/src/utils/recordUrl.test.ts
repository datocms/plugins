import { describe, expect, it } from 'vitest';
import { buildRecordEditorUrl } from './recordUrl';

describe('buildRecordEditorUrl', () => {
  it('builds a primary-environment editor URL', () => {
    expect(
      buildRecordEditorUrl({
        internalDomain: 'my-project.admin.datocms.com',
        environment: 'main',
        isEnvironmentPrimary: true,
        itemTypeId: 'IT1',
        recordId: 'R1',
      }),
    ).toBe(
      'https://my-project.admin.datocms.com/editor/item_types/IT1/items/R1/edit',
    );
  });

  it('includes the environment segment for a sandbox', () => {
    expect(
      buildRecordEditorUrl({
        internalDomain: 'my-project.admin.datocms.com',
        environment: 'sandbox-1',
        isEnvironmentPrimary: false,
        itemTypeId: 'IT1',
        recordId: 'R1',
      }),
    ).toBe(
      'https://my-project.admin.datocms.com/environments/sandbox-1/editor/item_types/IT1/items/R1/edit',
    );
  });

  it('returns undefined when domain, item type, or record id is missing', () => {
    expect(
      buildRecordEditorUrl({
        internalDomain: null,
        itemTypeId: 'IT1',
        recordId: 'R1',
      }),
    ).toBeUndefined();
    expect(
      buildRecordEditorUrl({
        internalDomain: 'd',
        itemTypeId: undefined,
        recordId: 'R1',
      }),
    ).toBeUndefined();
    expect(
      buildRecordEditorUrl({
        internalDomain: 'd',
        itemTypeId: 'IT1',
        recordId: '',
      }),
    ).toBeUndefined();
  });
});
