import { describe, expect, it } from 'vitest';
import { ACCOUNT_ROLE_ID, canRoleUseDatoAgent } from './permissions';

describe('canRoleUseDatoAgent', () => {
  it('always allows project owners', () => {
    expect(canRoleUseDatoAgent({ allowedRoleIds: null }, ACCOUNT_ROLE_ID)).toBe(
      true,
    );
    expect(canRoleUseDatoAgent({ allowedRoleIds: [] }, ACCOUNT_ROLE_ID)).toBe(
      true,
    );
  });

  it('keeps collaborators out until permissions are configured', () => {
    expect(canRoleUseDatoAgent({ allowedRoleIds: null }, 'editor-role')).toBe(
      false,
    );
  });

  it('treats an empty configured allowlist as owners-only', () => {
    expect(canRoleUseDatoAgent({ allowedRoleIds: [] }, 'editor-role')).toBe(
      false,
    );
  });

  it('uses the explicit collaborator allowlist exactly', () => {
    const config = { allowedRoleIds: ['editor-role', 'reviewer-role'] };

    expect(canRoleUseDatoAgent(config, 'editor-role')).toBe(true);
    expect(canRoleUseDatoAgent(config, 'reviewer-role')).toBe(true);
    expect(canRoleUseDatoAgent(config, 'admin-role')).toBe(false);
  });
});
