import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DatoGPTTranslateSidebar from './DatoGPTTranslateSidebar';
import type { ctxParamsType } from '../Config/ConfigScreen';

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
  ChatBubble: ({ bubble }: { bubble: { fieldLabel: string; locale: string } }) => (
    <div>{`${bubble.fieldLabel} (${bubble.locale})`}</div>
  ),
}));

import { translateRecordFields } from '../../utils/translateRecordFields';

describe('DatoGPTTranslateSidebar', () => {
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
    formValues: { internalLocales: ['en', 'it'] },
    notice: vi.fn(),
    alert: vi.fn(),
    navigateTo: vi.fn(),
    scrollToField: vi.fn(),
    theme: {
      semiTransparentAccentColor: 'rgba(0, 0, 0, 0.1)',
      accentColor: '#6b46ff',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates using the base field path and locale from a progress bubble', async () => {
    vi.mocked(translateRecordFields).mockImplementation(async (_ctx, _params, _targets, _source, options) => {
      options?.onStart?.('Title', 'it', 'title.it', 'title');
    });

    render(<DatoGPTTranslateSidebar ctx={baseCtx as any} />);

    fireEvent.click(screen.getByText('Translate all fields'));

    const bubbleButton = await screen.findByRole('button', {
      name: /Go to field: Title \(it\)/i,
    });
    fireEvent.click(bubbleButton);

    expect(baseCtx.scrollToField).toHaveBeenCalledWith('title', 'it');
  });

  it('shows a manual-save success notice after successful translation', async () => {
    vi.mocked(translateRecordFields).mockImplementation(async (_ctx, _params, _targets, _source, options) => {
      options?.onStart?.('Title', 'it', 'title.it', 'title');
      options?.onComplete?.('Title', 'it', 'title.it', 'title');
    });

    render(<DatoGPTTranslateSidebar ctx={baseCtx as any} />);

    fireEvent.click(screen.getByText('Translate all fields'));

    await waitFor(() => {
      expect(baseCtx.notice).toHaveBeenCalledWith(
        'Translations were applied to the form. Review them and click Save to persist the changes.'
      );
    });
  });
});
