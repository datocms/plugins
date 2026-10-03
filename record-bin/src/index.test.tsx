import { connect } from 'datocms-plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureDeletedItemsWithoutLambda } from './utils/lambdaLessCapture';

vi.mock('datocms-plugin-sdk', () => ({ connect: vi.fn() }));
vi.mock('./utils/lambdaLessCapture', () => ({
  captureDeletedItemsWithoutLambda: vi.fn(),
}));
vi.mock('./utils/render', () => ({ render: vi.fn() }));
vi.mock('./entrypoints/ConfigScreen', () => ({ default: () => null }));
vi.mock('./entrypoints/BinOutlet', () => ({ default: () => null }));
vi.mock('./entrypoints/ErrorModal', () => ({ default: () => null }));

import './index';

type Hook = (
  items: { id: string }[],
  ctx: ReturnType<typeof context>,
) => Promise<boolean>;
const hook = () => {
  const definition = vi.mocked(connect).mock.calls[0]?.[0];
  if (!definition?.onBeforeItemsDestroy)
    throw new Error('Hook was not registered.');
  return definition.onBeforeItemsDestroy as unknown as Hook;
};
const context = (runtimeMode = 'lambdaless') => ({
  plugin: { attributes: { parameters: { runtimeMode } } },
  openModal: vi.fn().mockResolvedValue(true),
  notice: vi.fn().mockResolvedValue(undefined),
});
beforeEach(() => {
  vi.mocked(captureDeletedItemsWithoutLambda).mockReset();
});
describe('delete hook decisions', () => {
  it('blocks incomplete captures and unexpected exceptions explicitly', async () => {
    vi.mocked(captureDeletedItemsWithoutLambda).mockResolvedValue({
      allowDeletion: false,
    } as never);
    expect(await hook()([{ id: 'one' }], context())).toBe(false);
    vi.mocked(captureDeletedItemsWithoutLambda).mockRejectedValue(
      new Error('unexpected'),
    );
    expect(await hook()([{ id: 'one' }], context())).toBe(false);
  });
  it('preserves the small-selection UI and blocks oversized host bulk operations', async () => {
    vi.mocked(captureDeletedItemsWithoutLambda).mockResolvedValue({
      allowDeletion: true,
    } as never);
    const ctx = context();
    expect(
      await hook()(
        Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}` })),
        ctx,
      ),
    ).toBe(true);
    expect(ctx.openModal).not.toHaveBeenCalled();
    const items = Array.from({ length: 201 }, (_, i) => ({
      id: `id-${i}`,
      attributes: { omitted: true },
    }));
    expect(await hook()(items, ctx)).toBe(false);
    expect(ctx.openModal).not.toHaveBeenCalled();
    expect(ctx.notice).toHaveBeenCalledWith(
      expect.stringContaining('above 200'),
    );
    expect(captureDeletedItemsWithoutLambda).toHaveBeenCalledTimes(1);
    ctx.notice.mockRejectedValue(new Error('notice failed'));
    expect(await hook()(items, ctx)).toBe(false);
  });
  it('preserves the separately deployed Lambda runtime contract', async () => {
    expect(await hook()([{ id: 'one' }], context('lambda'))).toBe(true);
    expect(captureDeletedItemsWithoutLambda).not.toHaveBeenCalled();
  });
});
