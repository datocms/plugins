import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../../utils/translation/types';
import YandexProvider from '../../../utils/translation/providers/YandexProvider';
import YandexConfig from './YandexConfig';

vi.mock('datocms-react-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  FieldGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextField: ({
    id,
    label,
    value,
    onChange,
    hint,
    textInputProps,
  }: {
    id: string;
    label: ReactNode;
    value: string;
    onChange: (value: string) => void;
    hint?: ReactNode;
    textInputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  }) => (
    <label htmlFor={id}>
      {label}
      <input
        {...textInputProps}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint}
    </label>
  ),
}));

function renderConfig(apiKey = 'api-key', folderId = '') {
  return render(
    <YandexConfig
      yandexApiKey={apiKey}
      setYandexApiKey={vi.fn()}
      yandexFolderId={folderId}
      setYandexFolderId={vi.fn()}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('YandexConfig', () => {
  it('masks the API key and limits the optional Folder ID', () => {
    renderConfig();

    expect(screen.getByLabelText('Yandex API Key').getAttribute('type')).toBe(
      'password',
    );
    const folderInput = screen.getByRole('textbox', {
      name: /^Yandex Folder ID/,
    }) as HTMLInputElement;
    expect(folderInput.maxLength).toBe(50);
  });

  it('tests credentials through the live language-list method', async () => {
    const listLanguages = vi
      .spyOn(YandexProvider.prototype, 'listLanguages')
      .mockResolvedValue([{ code: 'en' }, { code: 'it' }]);
    renderConfig('api-key', ' folder-id ');

    fireEvent.click(screen.getByRole('button', { name: 'Test credentials' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Credentials verified. Yandex returned 2 supported languages.',
    );
    expect(listLanguages).toHaveBeenCalledTimes(1);
  });

  it('shows normalized Yandex permission guidance', async () => {
    vi.spyOn(YandexProvider.prototype, 'listLanguages').mockRejectedValue(
      new ProviderError('Permission denied', 403, 'yandex'),
    );
    renderConfig();

    fireEvent.click(screen.getByRole('button', { name: 'Test credentials' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Yandex Cloud denied access to the Translate API.',
    );
    expect(alert.textContent).toContain('ai.translate.user');
  });

  it('requires an API key before testing', async () => {
    const listLanguages = vi.spyOn(
      YandexProvider.prototype,
      'listLanguages',
    );
    renderConfig('   ');

    fireEvent.click(screen.getByRole('button', { name: 'Test credentials' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Enter a Yandex API key first.',
    );
    expect(listLanguages).not.toHaveBeenCalled();
  });
});
