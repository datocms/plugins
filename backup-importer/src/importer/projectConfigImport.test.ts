/// <reference types="vitest" />

import { describe, expect, test, vi } from 'vitest';
import { importPluginsForSchema, importSiteBaseline } from './projectConfigImport';
import type { RecordExportEnvelope } from './types';

function buildEnvelope(site: Record<string, unknown> | null): RecordExportEnvelope {
  return {
    manifest: {
      exportVersion: '2.1.0',
      pluginVersion: '1.0.0',
      exportedAt: '2026-02-17T00:00:00.000Z',
      sourceProjectId: 'project-1',
      sourceEnvironment: 'main',
      defaultLocale: 'en',
      locales: ['en'],
      scope: 'bulk',
      filtersUsed: {},
    },
    schema: {
      itemTypes: [],
      fields: [],
      itemTypeIdToApiKey: {},
      fieldIdToApiKey: {},
      fieldsByItemType: {},
    },
    projectConfiguration: {
      site: site as any,
      scheduledPublications: [],
      scheduledUnpublishings: [],
      fieldsets: [],
      menuItems: [],
      schemaMenuItems: [],
      modelFilters: [],
      plugins: [],
      workflows: [],
      roles: [],
      webhooks: [],
      buildTriggers: [],
      warnings: [],
    },
    records: [],
    referenceIndex: {
      recordRefs: [],
      uploadRefs: [],
      structuredTextRefs: [],
      blockRefs: [],
    },
  };
}

function buildEnvelopeWithPlugins(
  plugins: Array<Record<string, unknown>>,
): RecordExportEnvelope {
  const envelope = buildEnvelope({
    id: 'source-site',
    locales: ['en'],
    timezone: 'UTC',
  });

  if (envelope.projectConfiguration) {
    envelope.projectConfiguration.plugins = plugins as any;
  }

  return envelope;
}

describe('importSiteBaseline', () => {
  test('retries without name when site name is not unique in target', async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce({
        message:
          'PUT https://site-api.datocms.com/site: 422 N/A\n{"details":{"field":"name","code":"VALIDATION_UNIQUENESS"}}',
        errors: [
          {
            attributes: {
              details: {
                field: 'name',
                code: 'VALIDATION_UNIQUENESS',
              },
            },
          },
        ],
      })
      .mockResolvedValueOnce({ id: 'site-1' });

    const result = await importSiteBaseline({
      client: {
        site: {
          update,
        },
      } as any,
      envelope: buildEnvelope({
        id: 'source-site',
        name: 'Source Site Name',
        locales: ['en'],
        timezone: 'UTC',
      }),
    });

    expect(result.failures).toHaveLength(0);
    expect(result.warnings.some((entry) => entry.includes('Skipped `site.name`'))).toBe(
      true,
    );
    expect(update).toHaveBeenCalledTimes(2);

    const firstPayload = update.mock.calls[0]?.[0] as Record<string, unknown>;
    const secondPayload = update.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(firstPayload.name).toBe('Source Site Name');
    expect(secondPayload.name).toBeUndefined();
  });

  test('returns failure when site update fails for non-name reason', async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error('Forbidden'));

    const result = await importSiteBaseline({
      client: {
        site: {
          update,
        },
      } as any,
      envelope: buildEnvelope({
        id: 'source-site',
        locales: ['en'],
        timezone: 'UTC',
      }),
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.message).toContain('Failed to apply site baseline');
  });

  test('add-only mode skips existing plugins by package name', async () => {
    const pluginUpdate = vi.fn(async () => ({}));
    const pluginCreate = vi.fn(async () => ({ id: 'created-plugin' }));
    const result = await importPluginsForSchema({
      client: {
        plugins: {
          list: vi.fn(async () => [
            {
              id: 'target-plugin-1',
              package_name: 'example/plugin',
            },
          ]),
          update: pluginUpdate,
          create: pluginCreate,
        },
      } as any,
      envelope: {
        ...buildEnvelope({
          id: 'source-site',
          locales: ['en'],
          timezone: 'UTC',
        }),
        projectConfiguration: {
          ...buildEnvelope({
            id: 'source-site',
            locales: ['en'],
            timezone: 'UTC',
          }).projectConfiguration!,
          plugins: [
            {
              id: 'plugin-source-1',
              package_name: 'example/plugin',
              name: 'Example plugin',
            },
          ],
        },
      },
      addOnlyDifferences: true,
    });

    expect(pluginUpdate).not.toHaveBeenCalled();
    expect(pluginCreate).not.toHaveBeenCalled();
    expect(result.failures).toHaveLength(0);
    expect(result.addOnlySkippedByResource.plugins).toBe(1);
    expect(
      result.warnings.some((entry) =>
        entry.includes("[add-only][plugins] Skipped existing plugin 'example/plugin'"),
      ),
    ).toBe(true);
  });

  test('creates package plugins using package install payload', async () => {
    const pluginCreate = vi.fn(async (_payload: unknown) => ({
      id: 'created-plugin',
    }));

    const result = await importPluginsForSchema({
      client: {
        plugins: {
          list: vi.fn(async () => []),
          update: vi.fn(async () => ({})),
          create: pluginCreate,
        },
      } as any,
      envelope: buildEnvelopeWithPlugins([
        {
          id: 'plugin-source-2',
          package_name: 'datocms-plugin-dropdown-conditional-fields',
          package_version: '1.2.3',
          name: 'Dropdown Conditional Fields',
          url: 'https://example.com',
          plugin_type: 'sidebar',
          field_types: ['string'],
          parameter_definitions: { global: [], instance: [] },
          permissions: ['currentUserAccessToken'],
        },
      ]),
    });

    expect(result.failures).toHaveLength(0);
    expect(pluginCreate).toHaveBeenCalledTimes(1);
    const payload = (pluginCreate.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(payload.package_name).toBe('datocms-plugin-dropdown-conditional-fields');
    expect(payload.package_version).toBe('1.2.3');
    expect('name' in payload).toBe(false);
    expect('url' in payload).toBe(false);
    expect('plugin_type' in payload).toBe(false);
    expect('field_types' in payload).toBe(false);
    expect('parameter_definitions' in payload).toBe(false);
  });

  test('falls back to private payload when package install fails', async () => {
    const pluginCreate = vi
      .fn(async (_payload: unknown) => ({ id: 'created-private-plugin' }))
      .mockRejectedValueOnce(new Error('INVALID_FORMAT'))
      .mockResolvedValueOnce({ id: 'created-private-plugin' });

    const result = await importPluginsForSchema({
      client: {
        plugins: {
          list: vi.fn(async () => []),
          update: vi.fn(async () => ({})),
          create: pluginCreate,
        },
      } as any,
      envelope: buildEnvelopeWithPlugins([
        {
          id: 'plugin-source-3',
          package_name: 'custom/non-installable-plugin',
          name: 'Project Exporter',
          url: 'https://example.com/plugin',
          plugin_type: 'sidebar',
          field_types: ['string', 'structured_text'],
          parameter_definitions: { global: [], instance: [] },
          permissions: ['currentUserAccessToken', 'unsupported_permission'],
        },
      ]),
    });

    expect(result.failures).toHaveLength(0);
    expect(pluginCreate).toHaveBeenCalledTimes(2);

    const firstPayload = (pluginCreate.mock.calls[0]?.[0] ?? {}) as Record<
      string,
      unknown
    >;
    const secondPayload = (pluginCreate.mock.calls[1]?.[0] ?? {}) as Record<
      string,
      unknown
    >;

    expect(firstPayload).toEqual({
      package_name: 'custom/non-installable-plugin',
    });
    expect(secondPayload.name).toBe('Project Exporter');
    expect(secondPayload.url).toBe('https://example.com/plugin');
    expect(secondPayload.plugin_type).toBe('sidebar');
    expect(secondPayload.field_types).toEqual(['string']);
    expect(secondPayload.permissions).toEqual(['currentUserAccessToken']);
  });
});
