import { describe, expect, it } from 'vitest';
import {
  isBulkResult,
  isCreatorSelection,
  resolveExecutionError,
} from './bulkCreatorWorkflow';

describe('serialized workflow boundaries', () => {
  it('does not expose arbitrary error messages containing request data', () => {
    expect(
      resolveExecutionError(new Error('Authorization: Bearer secret-token')),
    ).toBe('The creator change could not be completed. Request failed.');
  });
  it.each(['user', 'sso_user', 'account', 'organization'])(
    'accepts creator type %s',
    (userType) => {
      expect(isCreatorSelection({ userId: 'opaque-id', userType })).toBe(true);
    },
  );

  it.each([
    null,
    undefined,
    4,
    {},
    { userId: '', userType: 'user' },
    { userId: 'a', userType: 'upload' },
  ])('rejects invalid creators %j', (value) => {
    expect(isCreatorSelection(value)).toBe(false);
  });

  const validResult = {
    total: 5,
    succeeded: 1,
    failed: 1,
    unprocessed: 3,
    failureSamples: [{ id: 'a', error: 'Denied' }],
    stopped: true,
  };

  it('accepts honest partial outcomes', () => {
    expect(isBulkResult(validResult)).toBe(true);
  });

  it.each([
    { ...validResult, total: 6 },
    { ...validResult, failed: -1 },
    { ...validResult, failed: 0.5 },
    { ...validResult, failed: Number.NaN },
    { ...validResult, stopped: 'yes' },
    {
      ...validResult,
      failureSamples: [{ id: 'a', error: new Error('Denied') }],
    },
    { ...validResult, failureSamples: [null] },
    { ...validResult, stopReason: 4 },
    null,
  ])('rejects malformed or inconsistent bulk results %j', (value) => {
    expect(isBulkResult(value)).toBe(false);
  });
});
