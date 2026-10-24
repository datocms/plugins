import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropFocus } from '../../../test/dropFocus';
import { renderWithCanvas } from '../../../test/renderWithCanvas';
import YandexProvider from '../../../utils/translation/providers/YandexProvider';
import { ProviderError } from '../../../utils/translation/types';
import YandexConfig from './YandexConfig';

function renderConfig(apiKey = 'api-key', folderId = '') {
  const setYandexApiKey = vi.fn();
  const setYandexFolderId = vi.fn();
  const notice = vi.fn();
  const view = renderWithCanvas(
    <YandexConfig
      yandexApiKey={apiKey}
      setYandexApiKey={setYandexApiKey}
      yandexFolderId={folderId}
      setYandexFolderId={setYandexFolderId}
      notice={notice}
    />,
  );
  return { ...view, setYandexApiKey, setYandexFolderId, notice };
}

function testButton() {
  return screen.getByRole('button', { name: 'Test credentials' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('YandexConfig', () => {
  it('masks the API key and limits the optional Folder ID', () => {
    renderConfig();

    const guide = screen.getByRole('link', {
      name: 'Yandex Translate setup guide',
    });
    expect(guide.getAttribute('href')).toBe(
      'https://aistudio.yandex.ru/docs/en/translate/quickstart.html',
    );
    expect(guide.getAttribute('target')).toBe('_blank');

    expect(screen.getByLabelText(/^API key/).getAttribute('type')).toBe(
      'password',
    );
    const folderInput = screen.getByRole('textbox', {
      name: /^Folder ID/,
    }) as HTMLInputElement;
    expect(folderInput.maxLength).toBe(50);
  });

  it('tests credentials through the live language-list method', async () => {
    const listLanguages = vi
      .spyOn(YandexProvider.prototype, 'listLanguages')
      .mockResolvedValue([{ code: 'en' }, { code: 'it' }]);
    const { notice } = renderConfig('api-key', ' folder-id ');

    fireEvent.click(testButton());

    // A passed test is a finished action: a toast, not a callout.
    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        'Credentials verified. Yandex returned 2 supported languages.',
      ),
    );
    expect(screen.queryByText(/Credentials verified/)).not.toBeInTheDocument();
    expect(listLanguages).toHaveBeenCalledTimes(1);
  });

  it('gives the focus back to the button once the test ends', async () => {
    let fail: (error: unknown) => void = () => {};
    vi.spyOn(YandexProvider.prototype, 'listLanguages').mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    renderConfig();

    act(() => testButton().focus());
    fireEvent.click(testButton());
    expect(testButton()).toHaveAttribute('aria-busy', 'true');
    dropFocus();
    expect(document.activeElement).toBe(document.body);

    await act(async () =>
      fail(new ProviderError('Permission denied', 403, 'yandex')),
    );
    await screen.findByRole('alert');
    expect(testButton()).not.toHaveAttribute('aria-busy');
    expect(document.activeElement).toBe(testButton());
  });

  it('shows normalized Yandex permission guidance', async () => {
    vi.spyOn(YandexProvider.prototype, 'listLanguages').mockRejectedValue(
      new ProviderError('Permission denied', 403, 'yandex'),
    );
    renderConfig();

    fireEvent.click(testButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Yandex Cloud denied access to the Translate API.',
    );
    expect(alert.textContent).toContain('ai.translate.user');
  });

  it('clears a failed result when the API key changes', async () => {
    vi.spyOn(YandexProvider.prototype, 'listLanguages').mockRejectedValue(
      new ProviderError('Permission denied', 403, 'yandex'),
    );
    const { setYandexApiKey } = renderConfig();

    fireEvent.click(testButton());
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText(/^API key/), {
      target: { value: 'other-key' },
    });

    expect(setYandexApiKey).toHaveBeenCalledWith('other-key');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('requires an API key before testing', async () => {
    const listLanguages = vi.spyOn(YandexProvider.prototype, 'listLanguages');
    renderConfig('   ');

    const button = testButton();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    act(() => button.focus());

    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Enter a Yandex API key first.',
    );
    await waitFor(() => expect(listLanguages).not.toHaveBeenCalled());
  });
});
