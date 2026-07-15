import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RecordUnitsResult,
  TranslateRecordUnitsDeps,
} from '../../engine';
import type { ctxParamsType } from '../Config/ConfigScreen';
import TranslateSidebar from './TranslateSidebar';

/**
 * Wraps a partial test context object into the full SDK type.
 * Necessary because tests provide only the properties actually used by the
 * component.
 */
function asCtx(
  partial: Record<string, unknown>,
): RenderItemFormSidebarPanelCtx {
  return partial as unknown as RenderItemFormSidebarPanelCtx;
}

// The unified engine + its adapters/sink are exercised by their own unit tests;
// here we mock them so the sidebar's wiring is what's under test.
const translateRecordUnits = vi.fn();
const writeToForm = vi.fn();

vi.mock('../../engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine')>();
  return {
    ...actual,
    translateRecordUnits: (...args: unknown[]) => translateRecordUnits(...args),
  };
});

vi.mock('../../engine/formAdapter', () => ({
  itemToSimpleShape: (item: { attributes: Record<string, unknown> }) => ({
    itemTypeId: 'model-1',
    fields: item.attributes,
  }),
  payloadToFormWrites: () => [
    { fieldPath: 'title.it', locale: 'it', value: 'Ciao' },
  ],
  assertNoBareBlockIds: vi.fn(),
}));

vi.mock('../../engine/formSink', () => ({
  writeToForm: (...args: unknown[]) => writeToForm(...args),
}));

vi.mock('../../utils/clients', () => ({
  buildDatoCMSClient: () => ({}),
}));

vi.mock('../../utils/schemaRepository', () => ({
  createSchemaRepository: () => ({}),
}));

vi.mock('../../utils/translation/ItemsDropdownUtils', () => ({
  buildFieldTypeDictionaryWithRepo: async () => ({
    title: { editor: 'single_line', id: 'f-title', isLocalized: true },
  }),
}));

vi.mock('../../utils/translation/ProviderFactory', () => ({
  isProviderConfigured: () => true,
  getProvider: () => ({ vendor: 'openai' }),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const emptyResult: RecordUnitsResult = {
  payload: { title: { it: 'Ciao' } },
  translatedFieldCount: 1,
  referenceFieldsCopied: 0,
  translatedFields: ['title'],
  referenceCopies: [],
  warnings: [],
  errorCount: 0,
  qcFlags: [],
  failedFields: [],
  writtenLocales: { title: ['it'] },
};

describe('TranslateSidebar', () => {
  const pluginParams: ctxParamsType = {
    apiKey: 'test-key',
    gptModel: 'gpt-4',
    translationFields: ['single_line', 'slug', 'structured_text', 'rich_text'],
    translateWholeRecord: true,
    translateBulkRecords: true,
    prompt: '',
    modelsToBeExcludedFromThisPlugin: [],
    rolesToBeExcludedFromThisPlugin: [],
    apiKeysToBeExcludedFromThisPlugin: [],
    enableDebugging: false,
  };

  const baseCtx = {
    plugin: { id: 'plugin-1', attributes: { parameters: pluginParams } },
    itemType: {
      id: 'model-1',
      attributes: { name: 'Article', api_key: 'article' },
    },
    item: { id: 'record-1' },
    fields: {
      'f-title': {
        id: 'f-title',
        attributes: {
          api_key: 'title',
          field_type: 'single_line',
          appearance: { editor: 'single_line' },
          localized: true,
          validators: {},
        },
        relationships: { item_type: { data: { id: 'model-1' } } },
      },
    },
    formValues: { internalLocales: ['en', 'it'], title: { en: 'Hello' } },
    environment: 'main',
    cmaBaseUrl: undefined,
    currentUserAccessToken: 'token-abc',
    formValuesToItem: vi.fn(async () => ({
      attributes: { title: { en: 'Hello' } },
      relationships: { item_type: { data: { id: 'model-1' } } },
    })),
    setFieldValue: vi.fn(async () => {}),
    notice: vi.fn(),
    alert: vi.fn(),
    navigateTo: vi.fn(),
    scrollToField: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    translateRecordUnits.mockResolvedValue(emptyResult);
    writeToForm.mockResolvedValue({
      written: 1,
      discarded: 0,
      verifiedMissing: [],
    });
  });

  it('keeps field selection copy out of the compact sidebar', () => {
    render(<TranslateSidebar ctx={asCtx(baseCtx)} />);

    expect(screen.queryByText('Fields to translate')).toBeNull();
    expect(
      screen.queryByText(/Defaults to every translatable field/i),
    ).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'Translate all fields',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('runs the unified engine and stages writes through the form sink', async () => {
    render(<TranslateSidebar ctx={asCtx(baseCtx)} />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Translate all fields' }),
    );

    await waitFor(() => {
      expect(translateRecordUnits).toHaveBeenCalled();
    });

    // The form path must run with locale-sync OFF and onSystemic wired (§2.3-1/§2.3-7).
    const deps = translateRecordUnits.mock.calls[0]?.[2] as
      | TranslateRecordUnitsDeps
      | undefined;
    expect(deps?.options.applyLocaleSync).toBe(false);
    expect(typeof deps?.options.onSystemic).toBe('function');
    expect(typeof deps?.options.gate).toBe('function');

    await waitFor(() => {
      expect(writeToForm).toHaveBeenCalled();
    });
  });

  it('shows a manual-save success notice after a clean run', async () => {
    render(<TranslateSidebar ctx={asCtx(baseCtx)} />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Translate all fields' }),
    );

    await waitFor(() => {
      expect(baseCtx.notice).toHaveBeenCalledWith(
        'Translations were applied to the form. Review them and click Save to persist the changes.',
      );
    });
  });

  it('surfaces failed fields as a review alert', async () => {
    translateRecordUnits.mockResolvedValue({
      ...emptyResult,
      failedFields: [
        {
          field: 'title',
          error: { code: 'content', message: 'boom', vendor: 'openai' },
        },
      ],
    });

    render(<TranslateSidebar ctx={asCtx(baseCtx)} />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Translate all fields' }),
    );

    await waitFor(() => {
      expect(baseCtx.alert).toHaveBeenCalledWith(
        expect.stringContaining('may be incomplete'),
      );
    });
  });
});

/**
 * Type-level acceptance (§2.3-1): omitting `onSystemic` from the sidebar-facing
 * deps options is a COMPILE error. `tsc -b` (the build) checks this file, so the
 * `@ts-expect-error` below fails the build if the field ever becomes optional.
 */
function assertOnSystemicRequired(base: {
  gate: TranslateRecordUnitsDeps['options']['gate'];
}) {
  // @ts-expect-error onSystemic is required on TranslateRecordUnitsOptions.
  const bad: TranslateRecordUnitsDeps['options'] = { gate: base.gate };
  return bad;
}
void assertOnSystemicRequired;
