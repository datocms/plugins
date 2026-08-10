import type { AgentConfig } from './config';

export const ACCOUNT_ROLE_ID = 'account_role';

/**
 * Project owners use DatoCMS' synthetic `account_role` and always have access.
 * Collaborators must be present in the explicit role allowlist. Missing or
 * empty permissions therefore remain owners-only.
 */
export function canRoleUseDatoAgent(
  config: Pick<AgentConfig, 'allowedRoleIds'>,
  roleId: string | null | undefined,
): boolean {
  return (
    roleId === ACCOUNT_ROLE_ID ||
    (typeof roleId === 'string' &&
      config.allowedRoleIds?.includes(roleId) === true)
  );
}
