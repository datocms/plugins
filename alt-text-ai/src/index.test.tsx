import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  runAltGenerationForField: vi.fn(),
  runAltGenerationForUploads: vi.fn(),
}));

vi.mock('datocms-plugin-sdk', () => ({
  connect: mocks.connect,
}));

vi.mock('./entrypoints/ConfigScreen', () => ({
  default: () => null,
}));

vi.mock('./utils/render', () => ({
  render: vi.fn(),
}));

vi.mock('./services/altTextGeneration', () => ({
  hasGeneratableFieldValue: vi.fn(() => true),
  runAltGenerationForField: mocks.runAltGenerationForField,
  runAltGenerationForUploads: mocks.runAltGenerationForUploads,
}));

await import('./index');

type ConnectedHooks = {
  uploadsDropdownActions: () => Array<Record<string, unknown>>;
  executeUploadsDropdownAction: (
    actionId: string,
    uploads: unknown[],
    ctx: unknown,
  ) => Promise<void>;
};

function connectedHooks(): ConnectedHooks {
  const hooks = mocks.connect.mock.calls[0]?.[0];
  if (!hooks) {
    throw new Error('Plugin hooks were not connected.');
  }
  return hooks as ConnectedHooks;
}

beforeEach(() => {
  mocks.runAltGenerationForField.mockClear();
  mocks.runAltGenerationForUploads.mockClear();
});

describe('media-area dropdown actions', () => {
  it('declares generation actions for batch and single-upload menus', () => {
    expect(connectedHooks().uploadsDropdownActions()).toEqual([
      {
        id: 'generate-missing-alts',
        label: 'Generate missing alt texts',
        icon: 'magic',
        disabled: false,
      },
      {
        id: 'regenerate-all-alts',
        label: 'Regenerate all alt texts',
        icon: 'images',
        disabled: false,
      },
    ]);
  });

  it.each([
    ['generate-missing-alts', 'missing-only'],
    ['regenerate-all-alts', 'overwrite-all'],
  ] as const)('routes %s to %s generation', async (actionId, mode) => {
    const uploads = [{ id: 'upload-one' }];
    const ctx = { environment: 'sandbox' };

    await connectedHooks().executeUploadsDropdownAction(actionId, uploads, ctx);

    expect(mocks.runAltGenerationForUploads).toHaveBeenCalledWith(
      ctx,
      uploads,
      mode,
    );
  });

  it('ignores unrelated upload actions', async () => {
    await connectedHooks().executeUploadsDropdownAction(
      'another-plugin-action',
      [],
      {},
    );

    expect(mocks.runAltGenerationForUploads).not.toHaveBeenCalled();
  });
});
