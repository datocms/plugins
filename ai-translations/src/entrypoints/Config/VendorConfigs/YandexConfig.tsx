/**
 * YandexConfig.tsx
 * Configuration component for Yandex Translate vendor settings.
 */

import { Button, FieldGroup, TextField } from 'datocms-react-ui';
import { useState } from 'react';
import {
  formatErrorForUser,
  normalizeProviderError,
} from '../../../utils/translation/ProviderErrors';
import YandexProvider from '../../../utils/translation/providers/YandexProvider';
import s from '../../styles.module.css';

type CredentialTestStatus = 'idle' | 'success' | 'error';

export interface YandexConfigProps {
  yandexApiKey: string;
  setYandexApiKey: (value: string) => void;
  yandexFolderId: string;
  setYandexFolderId: (value: string) => void;
}

export default function YandexConfig({
  yandexApiKey,
  setYandexApiKey,
  yandexFolderId,
  setYandexFolderId,
}: YandexConfigProps) {
  const [isTestingCredentials, setIsTestingCredentials] = useState(false);
  const [testStatus, setTestStatus] = useState<CredentialTestStatus>('idle');
  const [testMessage, setTestMessage] = useState('');

  const resetTestResult = () => {
    setTestStatus('idle');
    setTestMessage('');
  };

  const handleApiKeyChange = (value: string) => {
    setYandexApiKey(value);
    resetTestResult();
  };

  const handleFolderIdChange = (value: string) => {
    setYandexFolderId(value);
    resetTestResult();
  };

  const handleTestCredentials = async () => {
    const apiKey = yandexApiKey.trim();
    if (!apiKey) {
      setTestStatus('error');
      setTestMessage('Enter a Yandex API key first.');
      return;
    }

    setIsTestingCredentials(true);
    resetTestResult();

    try {
      const provider = new YandexProvider({
        apiKey,
        folderId: yandexFolderId.trim() || undefined,
      });
      const languages = await provider.listLanguages();
      setTestStatus('success');
      setTestMessage(
        `Credentials verified. Yandex returned ${languages.length} supported ${languages.length === 1 ? 'language' : 'languages'}.`,
      );
    } catch (error) {
      const normalized = normalizeProviderError(error, 'yandex');
      setTestStatus('error');
      setTestMessage(formatErrorForUser(normalized));
    } finally {
      setIsTestingCredentials(false);
    }
  };

  return (
    <FieldGroup>
      <TextField
        required
        name="yandexApiKey"
        id="yandexApiKey"
        label="Yandex API Key"
        value={yandexApiKey}
        onChange={handleApiKeyChange}
        placeholder="AQVN..."
        textInputProps={{ type: 'password' }}
      />
      <TextField
        name="yandexFolderId"
        id="yandexFolderId"
        label="Yandex Folder ID"
        hint="Optional. When omitted, Yandex infers the service account's home folder where supported."
        value={yandexFolderId}
        onChange={handleFolderIdChange}
        placeholder="b1g..."
        textInputProps={{ maxLength: 50 }}
      />
      <p className={s.hint}>
        Use a service-account API key with the{' '}
        <code>ai.translate.user</code> role and the{' '}
        <code>yc.ai.translate.execute</code> API-key scope. See the{' '}
        <a
          href="https://aistudio.yandex.ru/docs/en/translate/quickstart.html"
          target="_blank"
          rel="noreferrer noopener"
        >
          Yandex Translate setup guide
        </a>
        .
      </p>
      <div className={s.buttonRow}>
        <Button
          buttonType="muted"
          disabled={isTestingCredentials}
          onClick={handleTestCredentials}
        >
          {isTestingCredentials ? 'Testing…' : 'Test credentials'}
        </Button>
      </div>
      {testStatus !== 'idle' && testMessage && (
        <div
          className={s.inlineStatus}
          role={testStatus === 'error' ? 'alert' : 'status'}
          style={{
            color:
              testStatus === 'error'
                ? 'var(--color--ink-danger)'
                : 'var(--color--ink-success)',
          }}
        >
          {testMessage}
        </div>
      )}
    </FieldGroup>
  );
}
