import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCtx, renderWithCanvas } from '../../test/renderWithCanvas';
import { listRelevantGeminiModels } from '../../utils/translation/GeminiModels';
import { listRelevantOpenAIModels } from '../../utils/translation/OpenAIModels';
import ConfigScreen from './ConfigScreen';

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: () => ({ roles: { list: async () => [] } }),
}));
vi.mock('../../utils/translation/OpenAIModels', () => ({
  listRelevantOpenAIModels: vi.fn(),
}));
vi.mock('../../utils/translation/GeminiModels', () => ({
  listRelevantGeminiModels: vi.fn(),
}));
vi.mock('../../utils/translation/AnthropicModels', () => ({
  listRelevantAnthropicModels: vi.fn().mockResolvedValue([]),
}));
vi.mock('./VendorConfigs/DeepLConfig', () => ({ default: () => null }));

const openAIModels = vi.mocked(listRelevantOpenAIModels);
const geminiModels = vi.mocked(listRelevantGeminiModels);

function context(parameters: Record<string, unknown>): RenderConfigScreenCtx {
  return makeCtx<RenderConfigScreenCtx>({
    plugin: { attributes: { parameters } },
    itemTypes: {},
    loadItemTypeFields: vi.fn().mockResolvedValue([]),
    site: { attributes: { locales: ['en', 'it'], internal_domain: null } },
    currentUserAccessToken: 'test-token',
    environment: 'main',
    cmaBaseUrl: 'https://site-api.datocms.com',
    updatePluginParameters: vi.fn().mockResolvedValue(undefined),
    notice: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn().mockResolvedValue(undefined),
  });
}

function renderScreen(ctx: RenderConfigScreenCtx) {
  return renderWithCanvas(<ConfigScreen ctx={ctx} />, ctx);
}

function modelField() {
  return screen.getByLabelText(/^Model/).closest('.form__field');
}

async function saveReason() {
  const button = screen.getByRole('button', { name: 'Save' });
  expect(button.getAttribute('aria-disabled')).toBe('true');
  act(() => button.focus());
  return (await screen.findByRole('tooltip')).textContent;
}

afterEach(() => {
  vi.restoreAllMocks();
  openAIModels.mockReset();
  geminiModels.mockReset();
});

describe('config model lists', () => {
  it('asks for the OpenAI API key before loading the models', async () => {
    renderScreen(context({ vendor: 'openai', apiKey: '', gptModel: 'None' }));

    expect(modelField()?.textContent).toContain(
      'Enter the API key to load the models.',
    );
    expect(openAIModels).not.toHaveBeenCalled();
    expect(await saveReason()).toBe('Enter the OpenAI API key.');
  });

  it('loads the OpenAI models and picks the first one when none is set', async () => {
    openAIModels.mockResolvedValue(['gpt-a', 'gpt-b']);
    const ctx = context({ vendor: 'openai', apiKey: 'sk-1', gptModel: 'None' });
    renderScreen(ctx);

    await waitFor(() => expect(modelField()?.textContent).toContain('gpt-a'));
    expect(openAIModels).toHaveBeenCalledWith('sk-1');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(ctx.updatePluginParameters).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-1', gptModel: 'gpt-a' }),
      ),
    );
  });

  it('shows a failed OpenAI request on the model and clears the model', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    openAIModels.mockRejectedValue(new Error('401'));
    renderScreen(
      context({ vendor: 'openai', apiKey: 'sk-bad', gptModel: 'gpt-old' }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      "Couldn't load the models. Check the API key.",
    );
    expect(modelField()?.textContent).not.toContain('gpt-old');
    // There is no model to pick, so Save says to check the key.
    expect(await saveReason()).toBe(
      "Check the API key: the models couldn't be loaded.",
    );
  });

  it('asks for a model while the loaded OpenAI models have none picked', async () => {
    let finish: (models: string[]) => void = () => {};
    openAIModels.mockReturnValue(
      new Promise<string[]>((resolve) => {
        finish = resolve;
      }),
    );
    renderScreen(
      context({ vendor: 'openai', apiKey: 'sk-1', gptModel: 'None' }),
    );

    await waitFor(() => expect(openAIModels).toHaveBeenCalledWith('sk-1'));
    expect(await saveReason()).toBe('Pick a model.');
    await act(async () => finish(['gpt-a']));
  });

  it('says to change the key when it gives no compatible OpenAI model', async () => {
    openAIModels.mockResolvedValue([]);
    renderScreen(
      context({ vendor: 'openai', apiKey: 'sk-1', gptModel: 'None' }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'No compatible models for this key.',
    );
    expect(await saveReason()).toBe(
      'Use an API key that has compatible models.',
    );
  });

  it('keeps the saved Gemini model when the key gives no compatible model', async () => {
    geminiModels.mockResolvedValue([]);
    renderScreen(
      context({
        vendor: 'google',
        googleApiKey: 'AIza-1',
        geminiModel: 'gemini-saved',
      }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'No compatible models for this key.',
    );
    expect(modelField()?.textContent).toContain('gemini-saved');
  });

  it('saves a cleared input as an empty string', async () => {
    const ctx = context({
      vendor: 'yandex',
      yandexApiKey: 'AQVN-1',
      yandexFolderId: 'b1g-1',
    });
    renderScreen(ctx);

    fireEvent.change(screen.getByRole('textbox', { name: /^Folder ID/ }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(ctx.updatePluginParameters).toHaveBeenCalledWith(
        expect.objectContaining({
          yandexApiKey: 'AQVN-1',
          yandexFolderId: '',
        }),
      ),
    );
  });
});
