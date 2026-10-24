/**
 * YandexConfig.tsx
 * Configuration component for Yandex Translate vendor settings: the settings
 * group with the API key, the optional folder ID and a credentials test. A
 * passed test is a toast (a finished action); a failed one stays as a danger
 * callout under the button until the key or the folder changes.
 */

import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import IdText from 'datocms-react-ui/IdText';
import { Page } from 'datocms-react-ui/Page';
import PasswordInput from 'datocms-react-ui/PasswordInput';
import StringInput from 'datocms-react-ui/StringInput';
import { useId, useState } from 'react';
import { useBusyFocus } from '../../../utils/retryFocus';
import {
  formatErrorForUser,
  normalizeProviderError,
} from '../../../utils/translation/ProviderErrors';
import YandexProvider from '../../../utils/translation/providers/YandexProvider';
import styles from '../Config.module.css';
import { vendorSettingsTitle } from '../configConstants';

const SETUP_GUIDE_URL =
  'https://aistudio.yandex.ru/docs/en/translate/quickstart.html';

/** The longest folder ID that Yandex Cloud accepts. */
const FOLDER_ID_MAX_LENGTH = 50;

type CredentialTestFailure = {
  /** The problem in a few words. */
  title: string;
  message: string;
};

const API_KEY_HINT = (
  <>
    Use a service-account API key with the <IdText id="ai.translate.user" />{' '}
    role and the <IdText id="yc.ai.translate.execute" /> scope.
  </>
);

const SETUP_GUIDE_DOCS = {
  label: 'Yandex Translate setup guide',
  to: SETUP_GUIDE_URL,
};

export interface YandexConfigProps {
  yandexApiKey: string;
  setYandexApiKey: (value: string) => void;
  yandexFolderId: string;
  setYandexFolderId: (value: string) => void;
  /** Shows a toast (`ctx.notice`): the result of a passed test. */
  notice: (message: string) => unknown;
}

export default function YandexConfig({
  yandexApiKey,
  setYandexApiKey,
  yandexFolderId,
  setYandexFolderId,
  notice,
}: YandexConfigProps) {
  const [testFailure, setTestFailure] = useState<CredentialTestFailure | null>(
    null,
  );
  const [isTesting, setIsTesting] = useState(false);

  const handleApiKeyChange = (value: string | null) => {
    setYandexApiKey(value ?? '');
    setTestFailure(null);
  };

  const handleFolderIdChange = (value: string | null) => {
    setYandexFolderId(value ?? '');
    setTestFailure(null);
  };

  const apiKey = yandexApiKey.trim();
  // "Test credentials" is found by its id, not a ref: while it is disabled
  // with a reason, the kit's tooltip clones it and reads `element.ref`,
  // which React 19 warns about.
  const testId = useId();
  const testDisabled = apiKey
    ? undefined
    : { reason: 'Enter a Yandex API key first.' };
  // The busy button is disabled, which drops its focus: once the test ends,
  // the button takes it back, just above the callout of a failure.
  const followTest = useBusyFocus(
    isTesting,
    () => document.getElementById(testId),
    testDisabled?.reason,
  );

  // The button is busy while the test runs. The state is the component's,
  // not the kit's (an `onClick` that returns a promise), so the focus comes
  // back in the commit that turns the button on again.
  const handleTestCredentials = async () => {
    if (!apiKey || isTesting) return;
    setTestFailure(null);
    followTest();
    setIsTesting(true);

    try {
      const provider = new YandexProvider({
        apiKey,
        folderId: yandexFolderId.trim() || undefined,
      });
      const languages = await provider.listLanguages();
      notice(
        `Credentials verified. Yandex returned ${languages.length} supported ${languages.length === 1 ? 'language' : 'languages'}.`,
      );
    } catch (error) {
      const normalized = normalizeProviderError(error, 'yandex');
      setTestFailure({
        title: "Couldn't verify the credentials",
        message: formatErrorForUser(normalized),
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Page.Group title={vendorSettingsTitle('yandex')}>
      <FieldWrapper
        label="API key"
        required
        hint={API_KEY_HINT}
        docs={SETUP_GUIDE_DOCS}
      >
        <PasswordInput
          name="yandexApiKey"
          value={yandexApiKey}
          onChange={handleApiKeyChange}
          placeholder="AQVN…"
          autoComplete="off"
          spellCheck={false}
        />
      </FieldWrapper>
      <FieldWrapper
        label="Folder ID"
        hint="Optional. Without it, Yandex uses the home folder of the service account."
      >
        <StringInput
          code
          name="yandexFolderId"
          value={yandexFolderId}
          onChange={handleFolderIdChange}
          placeholder="b1g…"
          maxLength={FOLDER_ID_MAX_LENGTH}
          autoComplete="off"
          spellCheck={false}
        />
      </FieldWrapper>
      <div className={styles.block}>
        <Button
          id={testId}
          label="Test credentials"
          busy={isTesting}
          disabled={testDisabled}
          onClick={() => {
            void handleTestCredentials();
          }}
        />
      </div>
      {testFailure && (
        <Callout tone="danger" title={testFailure.title}>
          {testFailure.message}
        </Callout>
      )}
    </Page.Group>
  );
}
