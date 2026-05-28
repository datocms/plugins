import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../../utils/translateRecordFields', () => ({
  translateRecordFields: vi.fn(),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock('./Components/ChatbubbleTranslate', () => ({
  ChatBubble: ({
    bubble,
  }: {
    bubble: { fieldLabel: string; locale: string };
  }) => <div>{`${bubble.fieldLabel} (${bubble.locale})`}</div>,
}));

import { translateRecordFields } from '../../utils/translateRecordFields';

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

  // Two localized single-line fields so the field picker has something to
  // populate and the Translate button enables itself.
  const stubFields = [
    {
      id: 'field-title',
      attributes: {
        api_key: 'title',
        label: 'Title',
        localized: true,
        position: 1,
        appearance: { editor: 'single_line' },
      },
    },
    {
      id: 'field-summary',
      attributes: {
        api_key: 'summary',
        label: 'Summary',
        localized: true,
        position: 2,
        appearance: { editor: 'single_line' },
      },
    },
  ];

  const baseCtx = {
    plugin: { id: 'plugin-1', attributes: { parameters: pluginParams } },
    itemType: {
      id: 'model-1',
      attributes: { name: 'Article', api_key: 'article' },
    },
    formValues: { internalLocales: ['en', 'it'] },
    notice: vi.fn(),
    alert: vi.fn(),
    navigateTo: vi.fn(),
    scrollToField: vi.fn(),
    loadItemTypeFields: vi.fn().mockResolvedValue(stubFields),
    theme: {
      semiTransparentAccentColor: 'rgba(0, 0, 0, 0.1)',
      accentColor: '#6b46ff',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    baseCtx.loadItemTypeFields.mockResolvedValue(stubFields);
  });

  it('navigates using the base field path and locale from a progress bubble', async () => {
    vi.mocked(translateRecordFields).mockImplementation(
      async (_ctx, _params, _targets, _source, options) => {
        options?.onStart?.('Title', 'it', 'title.it', 'title');
      },
    );

    render(<TranslateSidebar ctx={asCtx(baseCtx)} />);

    // Wait for the field picker to populate (Translate button enables once
    // fields load and at least one is selected).
    const translateButton = await screen.findByRole('button', {
      name: /^Translate all fields to/,
    });
    fireEvent.click(translateButton);

    const bubbleButton = await screen.findByRole('button', {
      name: /Go to field: Title \(it\)/i,
    });
    fireEvent.click(bubbleButton);

    expect(baseCtx.scrollToField).toHaveBeenCalledWith('title', 'it');
  });

  it('shows a manual-save success notice after successful translation', async () => {
    vi.mocked(translateRecordFields).mockImplementation(
      async (_ctx, _params, _targets, _source, options) => {
        options?.onStart?.('Title', 'it', 'title.it', 'title');
        options?.onComplete?.('Title', 'it', 'title.it', 'title');
      },
    );

    render(<TranslateSidebar ctx={asCtx(baseCtx)} />);

    const translateButton = await screen.findByRole('button', {
      name: /^Translate all fields to/,
    });
    fireEvent.click(translateButton);

    await waitFor(() => {
      expect(baseCtx.notice).toHaveBeenCalledWith(
        'Translations were applied to the form. Review them and click Save to persist the changes.',
      );
    });
  });
});
