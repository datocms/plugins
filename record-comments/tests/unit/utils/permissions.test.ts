import {
  filterReadableModels,
  hasUnrestrictedModelReadPermission,
} from '@utils/permissions';
import { describe, expect, it } from 'vitest';

const models = Array.from({ length: 5000 }, (_, index) => ({
  id: `model-${index}`,
  apiKey: `model_${index}`,
  name: `Model ${index}`,
  isBlockModel: index % 2 === 0,
}));

function context(positive: object[], negative: object[] = []) {
  return {
    environment: 'sandbox',
    currentRole: {
      attributes: {
        positive_item_type_permissions: positive,
        negative_item_type_permissions: negative,
      },
    },
  } as never;
}

describe('model permissions at scale', () => {
  it('indexes many permissions once while preserving the model order', () => {
    let permissionReads = 0;
    const positive = models.map((model) => ({
      environment: 'sandbox',
      action: 'read',
      get item_type() {
        permissionReads += 1;
        return model.id;
      },
    }));
    expect(filterReadableModels(context(positive), models)).toEqual(models);
    expect(permissionReads).toBeLessThanOrEqual(positive.length * 4);
  });

  it('preserves global allow, model deny and environment/action checks', () => {
    const positive = [
      { environment: 'sandbox', action: 'read', item_type: null },
    ];
    const negative = [
      { environment: 'sandbox', action: 'all', item_type: 'model-2' },
      { environment: 'other', action: 'read', item_type: null },
      { environment: 'sandbox', action: 'update', item_type: 'model-1' },
    ];
    expect(
      filterReadableModels(context(positive, negative), models.slice(0, 4)).map(
        (model) => model.id,
      ),
    ).toEqual(['model-0', 'model-1', 'model-3']);
  });

  it('preserves global denial and ignores missing model selectors', () => {
    expect(
      filterReadableModels(
        context(
          [{ environment: 'sandbox', action: 'read', item_type: null }],
          [{ environment: 'sandbox', action: 'read', item_type: null }],
        ),
        models,
      ),
    ).toEqual([]);
    expect(
      filterReadableModels(
        context([{ environment: 'sandbox', action: 'read' }]),
        models,
      ),
    ).toEqual([]);
  });
});

describe('full model visibility before field cleanup', () => {
  const allow = { environment: 'sandbox', action: 'read', item_type: null };

  it('accepts unrestricted global or model-specific reading', () => {
    expect(
      hasUnrestrictedModelReadPermission(context([allow]), 'model-0'),
    ).toBe(true);
    expect(
      hasUnrestrictedModelReadPermission(
        context([
          {
            ...allow,
            item_type: 'model-0',
            on_creator: 'anyone',
            localization_scope: 'all',
          },
        ]),
        'model-0',
      ),
    ).toBe(true);
    expect(
      hasUnrestrictedModelReadPermission(
        context([{ ...allow, item_type: 'model-1' }]),
        'model-0',
      ),
    ).toBe(false);
  });

  it.each([
    { on_creator: 'self' },
    { on_creator: 'role' },
    { workflow: 'workflow-1' },
    { on_stage: 'draft' },
    { to_stage: 'published' },
    { localization_scope: 'localized', locale: 'it' },
    { localization_scope: 'not_localized' },
    { locale: 'en' },
  ])('rejects partial positive visibility %j', (restriction) => {
    expect(
      hasUnrestrictedModelReadPermission(
        context([{ ...allow, ...restriction }]),
        'model-0',
      ),
    ).toBe(false);
  });

  it.each([
    { on_creator: 'self' },
    { on_creator: 'role' },
    { on_stage: 'draft' },
    { workflow: 'workflow-1' },
    { localization_scope: 'localized', locale: 'it' },
  ])(
    'rejects any matching negative visibility restriction %j',
    (restriction) => {
      expect(
        hasUnrestrictedModelReadPermission(
          context([allow], [{ ...allow, ...restriction }]),
          'model-0',
        ),
      ).toBe(false);
    },
  );

  it('ignores negative permissions for other models, environments or actions', () => {
    expect(
      hasUnrestrictedModelReadPermission(
        context(
          [allow],
          [
            { ...allow, item_type: 'model-1', on_creator: 'self' },
            { ...allow, environment: 'other', on_stage: 'draft' },
            { ...allow, action: 'update', on_creator: 'role' },
          ],
        ),
        'model-0',
      ),
    ).toBe(true);
  });
});
