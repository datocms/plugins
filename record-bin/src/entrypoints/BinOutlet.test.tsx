import { afterEach, describe, expect, it, vi } from 'vitest';
import type { errorObject } from '../types/types';
import { createDebugLogger } from '../utils/debugLogger';
import {
  LambdaLessRestoreError,
  restoreRecordWithoutLambda,
} from '../utils/lambdaLessRestore';
import { executeRestoreWithoutLambda } from './BinOutlet';

vi.mock('datocms-react-ui', () => ({}));
vi.mock('../utils/lambdaLessRestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/lambdaLessRestore')>()),
  restoreRecordWithoutLambda: vi.fn(),
}));

const restorationError = {
  simplifiedError: { details: {} },
  fullErrorPayload: '{}',
} as unknown as errorObject;
// Error toasts stay open until the user closes them, so their promise never settles here.
const callbacks = () => ({
  alertFn: vi.fn(() => new Promise<void>(() => {})),
  noticeFn: vi.fn(),
  navigateTo: vi.fn(),
  setError: vi.fn(),
});
const restore = (handlers: ReturnType<typeof callbacks>) =>
  executeRestoreWithoutLambda({
    trashRecordId: 'archive-id',
    parsedRecordBody: {},
    currentUserAccessToken: 'token',
    environment: 'sandbox',
    debugLogger: createDebugLogger(false, 'test'),
    isEnvironmentPrimary: false,
    ...handlers,
  });
afterEach(() => {
  vi.mocked(restoreRecordWithoutLambda).mockReset();
});

describe('Lambda-less restore flow', () => {
  it('finishes a failed restore without waiting for the alert to close', async () => {
    vi.mocked(restoreRecordWithoutLambda).mockRejectedValue(
      new LambdaLessRestoreError('rejected', restorationError),
    );
    const handlers = callbacks();
    await restore(handlers);
    expect(handlers.setError).toHaveBeenCalledWith(restorationError);
    expect(handlers.alertFn).toHaveBeenCalledWith(
      'The record could not be restored!',
    );
    expect(handlers.navigateTo).not.toHaveBeenCalled();
  });
  it('opens the restored record while the cleanup alert is still open', async () => {
    vi.mocked(restoreRecordWithoutLambda).mockResolvedValue({
      restoredRecord: { id: 'record-id', modelID: 'model-id' },
      cleanupError: restorationError,
    });
    const handlers = callbacks();
    await restore(handlers);
    expect(handlers.alertFn).toHaveBeenCalledWith(
      'The record was restored, but its archive could not be removed.',
    );
    expect(handlers.navigateTo).toHaveBeenCalledWith(
      '/environments/sandbox/editor/item_types/model-id/items/record-id',
    );
  });
});
