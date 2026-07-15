/**
 * Stage 7 — restricted-role auth context (spec §6.3/§9.4-5, phase-0 Task 8 step 1).
 *
 * Idempotently creates role `e2e-restricted-it`: can READ every model (so the
 * dashboard + plugin can render at all) but can only UPDATE the `it` locale on
 * `article`. This is the locale-scope pin's fixture — an admin login (the
 * suite's one existing auth state) can't exercise §6.3's silent-drop behavior
 * because admins aren't locale-restricted.
 *
 * If E2E_RESTRICTED_EMAIL is set and no collaborator with that email exists
 * yet, also sends a site invitation for the role. Accepting an invitation is a
 * human action the CMA cannot do on your behalf — this script only gets you to
 * "invitation sent"; e2e/tests/setup/global-setup.ts picks up the resulting
 * credentials from .env.testing once you've completed the human step below.
 *
 * Safe to re-run: role lookup is by name; invitation lookup is by matching
 * collaborator/pending-invitation email.
 *
 * ⚠ Role-rule shape (positive_item_type_permissions[].{action, environment,
 * item_type, on_creator, localization_scope, locale}) is transcribed from the
 * installed @datocms/cma-client type defs (ApiTypes.RoleItemTypePermissionRead /
 * RoleItemTypePermissionUpdateOrPublish), not merely assumed from the plan —
 * but has NOT been round-tripped against the live CMA. Re-verify on the first
 * credentialed run (`node 7-restricted-role.mjs`) that the role is accepted
 * as-is; if the API 422s on an unexpected key, adjust here before re-running.
 */
import { client, section, step } from './lib/config.mjs';

const PRIMARY_ENV = 'main'; // matches e2e/tests/setup/constants.ts's PRIMARY_ENV
const ROLE_NAME = 'e2e-restricted-it';

const itemTypes = await client.itemTypes.list();
const byKey = Object.fromEntries(itemTypes.map((it) => [it.api_key, it]));
const article = byKey.article;
if (!article) throw new Error('run 1-schema.mjs first (article missing)');

section('STAGE 7 — restricted-role auth context');

const roles = await client.roles.list();
let role = roles.find((r) => r.name === ROLE_NAME);

if (role) {
  console.log(`  ✓ role "${ROLE_NAME}" (exists)`);
} else {
  role = await step(`role "${ROLE_NAME}"`, () =>
    client.roles.create({
      name: ROLE_NAME,
      // Everything project-level stays locked down; this role exists only to
      // exercise the locale-scope pin, not to administer the fixture project.
      can_edit_schema: false,
      can_edit_site: false,
      can_edit_favicon: false,
      can_manage_menu: false,
      can_edit_environment: false,
      can_promote_environments: false,
      environments_access: 'primary_only',
      can_manage_users: false,
      can_manage_shared_filters: false,
      can_manage_upload_collections: false,
      can_manage_build_triggers: false,
      can_manage_search_indexes: false,
      can_manage_webhooks: false,
      can_manage_environments: false,
      can_manage_sso: false,
      can_access_audit_log: false,
      can_manage_workflows: false,
      can_manage_access_tokens: false,
      can_perform_site_search: false,
      can_access_build_events_log: false,
      can_access_search_index_events_log: false,
      positive_item_type_permissions: [
        // Read every model (in every locale) — required just to see records
        // and open the plugin sidebar.
        {
          action: 'read',
          environment: PRIMARY_ENV,
          item_type: null,
          on_creator: 'anyone',
        },
        // The one actual restriction under test: `article` is writable, but
        // ONLY the `it` locale.
        {
          action: 'update',
          environment: PRIMARY_ENV,
          item_type: article.id,
          on_creator: 'anyone',
          localization_scope: 'localized',
          locale: 'it',
        },
      ],
      negative_item_type_permissions: [],
      // Read-only on uploads so images in seeded records still render.
      positive_upload_permissions: [
        { action: 'read', environment: PRIMARY_ENV, on_creator: 'anyone' },
      ],
      negative_upload_permissions: [],
    }),
  );
}

// --- optional: invite a real collaborator so the role can actually log in ---
const email = process.env.E2E_RESTRICTED_EMAIL;
if (!email) {
  console.log('  … E2E_RESTRICTED_EMAIL not set — skipping invitation (role is ready when you provision one)');
} else {
  const users = await client.users.list();
  const alreadyCollaborator = users.some((u) => u.email === email);
  if (alreadyCollaborator) {
    console.log(`  ✓ collaborator ${email} already exists (skipped invitation)`);
  } else {
    const invitations = await client.siteInvitations.list();
    const alreadyInvited = invitations.some((inv) => inv.email === email);
    if (alreadyInvited) {
      console.log(`  ✓ invitation for ${email} already pending (skipped)`);
    } else {
      await step(`site invitation → ${email}`, () =>
        client.siteInvitations.create({
          email,
          role: { type: 'role', id: role.id },
        }),
      );
    }
  }
}

section('STAGE 7 complete');
console.log(`Role: ${role.id} (${ROLE_NAME})`);
if (email) {
  console.log(`
⚠ HUMAN STEP: accept the invitation sent to ${email}, set the password, and put
  E2E_RESTRICTED_EMAIL / E2E_RESTRICTED_PASSWORD into .env.testing.
`);
}
