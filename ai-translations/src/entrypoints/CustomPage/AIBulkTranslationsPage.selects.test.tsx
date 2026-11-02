/**
 * The bulk page with the kit's real selects and field picker: picking with
 * the v3 SelectInput (string values, chosen options as the second argument)
 * drives the model, target and source state.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCtx, renderWithCanvas } from '../../test/renderWithCanvas';
import type { SdkField } from '../../utils/translation/BulkTranslationHelpers';
import type { ctxParamsType } from '../Config/ConfigScreen';
import AIBulkTranslationsPage from './AIBulkTranslationsPage';

const mocks = vi.hoisted(() => ({
  buildDatoCMSClient: vi.fn(),
}));

vi.mock('../../utils/clients', () => ({
  buildDatoCMSClient: mocks.buildDatoCMSClient,
}));

const pluginParams: ctxParamsType = {
  vendor: 'openai',
  apiKey: 'provider-key',
  gptModel: 'test-model',
  translationFields: ['single_line'],
  translateWholeRecord: true,
  translateBulkRecords: true,
  prompt: '',
  modelsToBeExcludedFromThisPlugin: [],
  rolesToBeExcludedFromThisPlugin: [],
  apiKeysToBeExcludedFromThisPlugin: [],
  enableDebugging: false,
};

const fields: SdkField[] = [
  {
    id: 'title-field',
    attributes: {
      api_key: 'title',
      label: 'Title',
      localized: true,
      position: 0,
      appearance: { editor: 'single_line' },
    },
  },
];

function pick(combobox: HTMLElement, optionName: string) {
  fireEvent.keyDown(combobox, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name: optionName }));
}

/** The text of the chosen values of the target locales select. */
function pickedTargets(): string {
  const combobox = screen.getByRole('combobox', { name: /^Translate into/ });
  const values = combobox.closest('[class*="value-container"]');
  if (!values) throw new Error('No value container for the target locales');
  return values.textContent ?? '';
}

describe('AIBulkTranslationsPage selects', () => {
  beforeEach(() => {
    mocks.buildDatoCMSClient.mockReturnValue({
      itemTypes: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'article',
            api_key: 'article',
            name: 'Articles',
            modular_block: false,
          },
        ]),
      },
      site: {
        find: vi.fn().mockResolvedValue({ locales: ['en', 'it', 'fr'] }),
      },
    });
  });

  afterEach(cleanup);

  it('picks a model, narrows the targets and moves the source', async () => {
    const ctx = makeCtx<RenderPageCtx>({
      currentUserAccessToken: 'cma-token',
      environment: 'main',
      isEnvironmentPrimary: true,
      cmaBaseUrl: 'https://cma.example.test',
      plugin: { id: 'plugin-id', attributes: { parameters: pluginParams } },
      currentRole: {
        meta: {
          final_permissions: {
            can_edit_environment: true,
            can_edit_schema: true,
          },
        },
      },
      loadItemTypeFields: vi.fn().mockResolvedValue(fields),
    });
    renderWithCanvas(<AIBulkTranslationsPage ctx={ctx} />, ctx);

    pick(
      await screen.findByRole('combobox', { name: /^Models/ }),
      'Articles article',
    );
    // The model's field picker loads its fields, all picked by default.
    expect(await screen.findByText('All fields')).toBeTruthy();
    expect(pickedTargets()).toBe('All other locales');

    // A specific target replaces "All other locales".
    const targets = screen.getByRole('combobox', { name: /^Translate into/ });
    pick(targets, 'Italian [it]');
    expect(screen.queryByText('All other locales')).toBeNull();
    expect(pickedTargets()).toMatch(/^Italian/);

    // Picking the target as the source drops it from the targets, which
    // fall back to "All other locales".
    pick(
      screen.getByRole('combobox', { name: /^Translate from/ }),
      'Italian [it]',
    );
    await waitFor(() =>
      expect(screen.getByText('All other locales')).toBeTruthy(),
    );
    expect(pickedTargets()).toBe('All other locales');
    const primary = screen.getByRole('button', { name: 'Translate records' });
    expect(primary).not.toHaveAttribute('aria-disabled');
  });
});
