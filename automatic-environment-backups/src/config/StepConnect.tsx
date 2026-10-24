import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import { Page, type PageGroupProps } from 'datocms-react-ui/Page';
import SettingsList from 'datocms-react-ui/SettingsList';
import Spinner from 'datocms-react-ui/Spinner';
import { useState } from 'react';
import styles from './StepContent.module.css';
import {
  type BackupsConfig,
  BUSY_REASON,
  READ_ONLY_REASON,
} from './useBackupsConfig';

type Props = {
  config: BackupsConfig;
  group: Pick<PageGroupProps, 'status' | 'collapse'>;
};

const getConnectionValue = (
  isTesting: boolean,
  isConnected: boolean,
  hasError: boolean,
) => {
  if (isTesting) {
    return (
      <>
        <Spinner inline label={false} /> Testing…
      </>
    );
  }
  if (isConnected) {
    return (
      <>
        <FeedbackDot tone="success" /> Verified
      </>
    );
  }
  if (hasError) {
    return (
      <>
        <FeedbackDot tone="danger" /> Failed
      </>
    );
  }
  return 'Not tested';
};

/** The error to show: this session's failed test, else the stored failure. */
const getActiveError = ({
  isConnected,
  connection,
  connectionErrorDetails,
  connectionTestError,
}: BackupsConfig) => {
  const persistedError =
    !isConnected && connection?.status === 'disconnected'
      ? (connection.errorMessage ??
        'The last connection check failed. Test the connection again.')
      : null;
  return {
    summary:
      connectionTestError?.summary ??
      (persistedError ? 'Connection failed' : null),
    message: connectionTestError ? null : persistedError,
    details: connectionTestError?.details ?? connectionErrorDetails,
  };
};

const getTestReason = (config: BackupsConfig, isTesting: boolean) => {
  if (!config.canEdit) {
    return READ_ONLY_REASON;
  }
  return config.isBusy && !isTesting ? BUSY_REASON : undefined;
};

/** Step 3: test the saved deployment URL and shared secret. */
export const StepConnect = ({ config, group }: Props) => {
  const {
    testConnection,
    isConnecting,
    isMountChecking,
    isConnected,
    savedUrl,
  } = config;

  const [showDetails, setShowDetails] = useState(false);
  const isTesting = isConnecting || isMountChecking;
  const activeError = getActiveError(config);
  const testReason = getTestReason(config, isTesting);
  const testDisabled = testReason ? { reason: testReason } : false;

  return (
    <Page.Group
      title="3. Test the connection"
      {...group}
      footer={
        (!isConnected || isTesting) && (
          <div className={styles.buttons}>
            <Button
              tone="primary"
              label="Verify connection & continue"
              className={styles.end}
              busy={isTesting}
              onClick={() => {
                void testConnection();
              }}
              disabled={testDisabled}
            />
          </div>
        )
      }
    >
      <SettingsList className={styles.block}>
        <SettingsList.Row
          title="Connection"
          description={savedUrl}
          value={getConnectionValue(
            isTesting,
            isConnected,
            Boolean(activeError.summary),
          )}
          action={
            isConnected &&
            !isTesting && (
              <Button
                tone="ghost"
                label="Test again"
                onClick={() => {
                  void testConnection();
                }}
                disabled={testDisabled}
              />
            )
          }
        />
      </SettingsList>
      {!isTesting && activeError.summary && (
        <>
          <Callout
            tone="danger"
            title={activeError.message ? activeError.summary : undefined}
          >
            {activeError.message ?? activeError.summary}
          </Callout>
          {activeError.details.length > 0 && (
            <Button
              tone="ghost"
              label={
                showDetails
                  ? 'Hide technical details'
                  : 'Show technical details'
              }
              aria-expanded={showDetails}
              className={styles.block}
              onClick={() => setShowDetails(!showDetails)}
            />
          )}
          {activeError.details.length > 0 && showDetails && (
            <CodeSnippet
              ariaLabel="Technical details"
              code={activeError.details.join('\n')}
            />
          )}
        </>
      )}
    </Page.Group>
  );
};
