import type { ExecuteItemFormDropdownActionCtx } from 'datocms-plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LambdaLessRestoreError,
  restoreRecordWithoutLambda,
} from './lambdaLessRestore';
import { ERROR_MODAL_ID, restoreRecordFromBin } from './restoreRecordFromBin';

vi.mock('./lambdaLessRestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lambdaLessRestore')>()),
  restoreRecordWithoutLambda: vi.fn(),
}));

function context(recordBody: unknown = '{"__record_bin":{}}') {
  return {
    plugin: { attributes: { parameters: { runtimeMode: 'lambdaless' } } },
    item: { id: 'trash-1' },
    itemType: { id: 'record-bin-model' },
    formValues: { record_body: recordBody },
    currentUserAccessToken: 'token',
    cmaBaseUrl: 'https://site-api.datocms.com',
    environment: 'sandbox',
    isEnvironmentPrimary: false,
    alert: vi.fn().mockResolvedValue(undefined),
    notice: vi.fn().mockResolvedValue(undefined),
    navigateTo: vi.fn().mockResolvedValue(undefined),
    customToast: vi.fn().mockResolvedValue(null),
    openModal: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExecuteItemFormDropdownActionCtx & {
    alert: ReturnType<typeof vi.fn>;
    notice: ReturnType<typeof vi.fn>;
    navigateTo: ReturnType<typeof vi.fn>;
    customToast: ReturnType<typeof vi.fn>;
    openModal: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.mocked(restoreRecordWithoutLambda).mockReset();
});

describe('restoreRecordFromBin', () => {
  it('restores the record, says so and opens it', async () => {
    vi.mocked(restoreRecordWithoutLambda).mockResolvedValue({
      restoredRecord: { id: 'restored-1', modelID: 'article' },
    } as never);
    const ctx = context();

    await restoreRecordFromBin(ctx);

    expect(restoreRecordWithoutLambda).toHaveBeenCalledWith(
      expect.objectContaining({
        trashRecordID: 'trash-1',
        currentEnvironment: 'sandbox',
        recordBody: { __record_bin: {} },
      }),
    );
    expect(ctx.notice).toHaveBeenCalledWith('The record has been restored.');
    expect(ctx.navigateTo).toHaveBeenCalledWith(
      '/environments/sandbox/editor/item_types/article/items/restored-1',
    );
  });

  it('says when the record body is not valid JSON', async () => {
    const ctx = context('{not json');
    await restoreRecordFromBin(ctx);
    expect(ctx.alert).toHaveBeenCalledWith(
      'The record body is not valid JSON.',
    );
    expect(restoreRecordWithoutLambda).not.toHaveBeenCalled();
  });

  it('offers the full error of a failed restoration in a modal', async () => {
    const restorationError = {
      simplifiedError: { details: {} },
      fullErrorPayload: '{"code":"INVALID_FIELD"}',
    };
    vi.mocked(restoreRecordWithoutLambda).mockRejectedValue(
      new LambdaLessRestoreError('Restore failed', restorationError),
    );
    const ctx = context();
    ctx.customToast.mockResolvedValue('details');

    await restoreRecordFromBin(ctx);

    expect(ctx.alert).not.toHaveBeenCalled();
    expect(ctx.customToast).toHaveBeenCalledWith({
      type: 'alert',
      message: 'The record could not be restored.',
      cta: { label: 'See the full error', value: 'details' },
    });
    await vi.waitFor(() =>
      expect(ctx.openModal).toHaveBeenCalledWith({
        id: ERROR_MODAL_ID,
        title: 'Restoration error',
        width: 'l',
        parameters: { errorPayload: '{"code":"INVALID_FIELD"}' },
      }),
    );
    expect(ctx.navigateTo).not.toHaveBeenCalled();
  });

  it('runs one restoration at a time', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.mocked(restoreRecordWithoutLambda).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const ctx = context();

    const first = restoreRecordFromBin(ctx);
    await restoreRecordFromBin(ctx);
    expect(restoreRecordWithoutLambda).toHaveBeenCalledTimes(1);
    finish({ restoredRecord: { id: 'restored-1', modelID: 'article' } });
    await first;
  });
});
