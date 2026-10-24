import { describe, expect, it } from 'vitest';
import { buildRecordEditorPath } from './recordUrl';

describe('buildRecordEditorPath', () => {
  it('builds a primary-environment editor path', () => {
    expect(
      buildRecordEditorPath({
        internalDomain: 'my-project.admin.datocms.com',
        environment: 'main',
        isEnvironmentPrimary: true,
        itemTypeId: 'IT1',
        recordId: 'R1',
      }),
    ).toBe('/editor/item_types/IT1/items/R1/edit');
  });

  it('includes the environment segment for a sandbox', () => {
    expect(
      buildRecordEditorPath({
        internalDomain: 'my-project.admin.datocms.com',
        environment: 'sandbox-1',
        isEnvironmentPrimary: false,
        itemTypeId: 'IT1',
        recordId: 'R1',
      }),
    ).toBe('/environments/sandbox-1/editor/item_types/IT1/items/R1/edit');
  });

  it('returns undefined when domain, item type, or record id is missing', () => {
    expect(
      buildRecordEditorPath({
        internalDomain: null,
        itemTypeId: 'IT1',
        recordId: 'R1',
      }),
    ).toBeUndefined();
    expect(
      buildRecordEditorPath({
        internalDomain: 'd',
        itemTypeId: undefined,
        recordId: 'R1',
      }),
    ).toBeUndefined();
    expect(
      buildRecordEditorPath({
        internalDomain: 'd',
        itemTypeId: 'IT1',
        recordId: '',
      }),
    ).toBeUndefined();
  });
});
