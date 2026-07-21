import { describe, expect, it } from 'vitest';
import { buildRecordEditorUrl } from './navigation';

describe('record navigation', () => {
  it('builds a primary-environment URL', () => {
    expect(
      buildRecordEditorUrl({
        environment: 'main',
        isEnvironmentPrimary: true,
        modelId: 'article',
        itemId: 'record-1',
      }),
    ).toBe('/editor/item_types/article/items/record-1');
  });

  it('prefixes sandbox-environment URLs', () => {
    expect(
      buildRecordEditorUrl({
        environment: 'preview',
        isEnvironmentPrimary: false,
        modelId: 'article',
        itemId: 'record-1',
      }),
    ).toBe('/environments/preview/editor/item_types/article/items/record-1');
  });
});
