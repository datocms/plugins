import { describe, expect, it } from 'vitest';
import { projectAdminUrl, recordEditorPath } from './projectUrl';

describe('projectAdminUrl', () => {
  it('omits the environment prefix on the primary environment', () => {
    expect(
      projectAdminUrl(
        {
          internalDomain: 'example.admin.datocms.com',
          environment: 'main',
          isEnvironmentPrimary: true,
        },
        '/project_settings/users',
      ),
    ).toBe('https://example.admin.datocms.com/project_settings/users');
  });

  it('prefixes a sandbox environment and builds the record editor path', () => {
    expect(
      projectAdminUrl(
        {
          internalDomain: ' example.admin.datocms.com ',
          environment: 'staging',
          isEnvironmentPrimary: false,
        },
        recordEditorPath('model/1', 'item 2'),
      ),
    ).toBe(
      'https://example.admin.datocms.com/environments/staging/editor/item_types/model%2F1/items/item%202/edit',
    );
  });

  it('returns null when the project has no admin domain', () => {
    expect(
      projectAdminUrl(
        {
          internalDomain: ' ',
          environment: 'main',
          isEnvironmentPrimary: true,
        },
        '/editor',
      ),
    ).toBeNull();
  });
});
