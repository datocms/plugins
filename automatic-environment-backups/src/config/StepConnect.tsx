import { Button, Spinner } from 'datocms-react-ui';
import { useState } from 'react';
import { StatusBox } from './StatusBox';
import { StepActionArrow } from './StepActionArrow';
import styles from './StepContent.module.css';
import type { BackupsConfig } from './useBackupsConfig';

const spinnerRowStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--spacing-s)',
} as const;

const compactSuccessStyle = {
  flex: '1 1 240px',
  padding: 'var(--spacing-s) var(--spacing-m)',
} as const;

/** Step 3 — test the saved deployment URL and shared secret. */
export const StepConnect = ({ config }: { config: BackupsConfig }) => {
  const {
    canEdit,
    testConnection,
    isConnecting,
    isMountChecking,
    isConnected,
    connection,
    connectionErrorDetails,
    connectionTestError,
    savedUrl,
  } = config;

  const [showDetails, setShowDetails] = useState(false);
  const isTesting = isConnecting || isMountChecking;
  const persistedError =
    !isConnected && connection?.status === 'disconnected'
      ? (connection.errorMessage ??
        'The last connection check failed. Test the connection again.')
      : null;
  const activeErrorSummary =
    connectionTestError?.summary ??
    (persistedError ? 'Connection failed' : null);
  const activeErrorMessage = connectionTestError ? null : persistedError;
  const activeErrorDetails =
    connectionTestError?.details ?? connectionErrorDetails;

  return (
    <>
      <p className={styles.savedUrl}>
        <strong>Deployment:</strong> {savedUrl}
      </p>

      {!isTesting && isConnected ? (
        <div className={styles.connectionResultRow}>
          <StatusBox
            variant="success"
            title="Connection verified"
            style={compactSuccessStyle}
          />
          <Button
            buttonType="muted"
            buttonSize="s"
            onClick={() => {
              void testConnection();
            }}
            disabled={!canEdit}
          >
            Test again
          </Button>
        </div>
      ) : (
        <>
          {isTesting ? (
            <StatusBox variant="neutral">
              <span style={spinnerRowStyle}>
                <Spinner size={20} />
                Testing {savedUrl}…
              </span>
            </StatusBox>
          ) : activeErrorSummary ? (
            <StatusBox variant="error" title={activeErrorSummary}>
              {activeErrorMessage}
              {activeErrorDetails.length > 0 && (
                <div style={{ marginTop: 'var(--spacing-s)' }}>
                  <Button
                    buttonType="muted"
                    buttonSize="xs"
                    onClick={() => setShowDetails((current) => !current)}
                  >
                    {showDetails
                      ? 'Hide technical details'
                      : 'Show technical details'}
                  </Button>
                  {showDetails && (
                    <ul
                      style={{
                        margin: 'var(--spacing-s) 0 0',
                        paddingLeft: '1.2em',
                      }}
                    >
                      {activeErrorDetails.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </StatusBox>
          ) : null}

          <div className={styles.stepFooter}>
            <div className={styles.stepFooterPrimary}>
              <Button
                buttonType="primary"
                buttonSize="s"
                onClick={() => {
                  void testConnection();
                }}
                disabled={!canEdit || isTesting}
                leftIcon={isTesting ? <Spinner size={16} /> : undefined}
                rightIcon={!isTesting ? <StepActionArrow /> : undefined}
              >
                {isTesting ? 'Testing…' : 'Verify connection & continue'}
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
};
