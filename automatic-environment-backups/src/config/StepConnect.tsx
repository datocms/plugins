import { Button, TextField } from 'datocms-react-ui';
import { useState } from 'react';
import { StatusBox } from './StatusBox';
import type { BackupsConfig } from './useBackupsConfig';

/**
 * Step 2 — point the plugin at the deployed function and verify it responds and
 * authenticates. The single action persists the URL triplet, runs the health
 * ping with the saved secret, and persists the resulting connection state; the
 * `StatusBox` reflects testing / connected / failed with the exact reason.
 */
export const StepConnect = ({ config }: { config: BackupsConfig }) => {
  const {
    urlInput,
    setUrlInput,
    saveAndTestConnection,
    disconnect,
    isConnecting,
    isMountChecking,
    isDisconnecting,
    isConnected,
    connection,
    connectionErrorDetails,
    connectionTestError,
    savedUrl,
  } = config;

  const [showDetails, setShowDetails] = useState(false);

  const isTesting = isConnecting || isMountChecking;
  const hasSavedUrl = savedUrl.trim().length > 0;
  const persistedError =
    !isConnected && connection?.status === 'disconnected'
      ? connection.errorMessage ??
        'Last connection check failed. Re-test the connection.'
      : null;

  return (
    <>
      <TextField
        name="deploymentURL"
        id="deploymentURL"
        label="Deployed function URL"
        value={urlInput}
        placeholder="https://backups.example.com/"
        onChange={setUrlInput}
      />

      <div style={{ display: 'flex', gap: 'var(--spacing-s)', flexWrap: 'wrap' }}>
        <Button
          buttonType="primary"
          buttonSize="s"
          onClick={() => {
            void saveAndTestConnection();
          }}
          disabled={isTesting || isDisconnecting}
        >
          {isConnecting ? 'Testing…' : 'Save & test connection'}
        </Button>
        {hasSavedUrl && (
          <Button
            buttonType="negative"
            buttonSize="s"
            onClick={() => {
              void disconnect();
            }}
            disabled={isTesting || isDisconnecting}
          >
            {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        )}
      </div>

      {isTesting ? (
        <StatusBox variant="neutral">Testing connection…</StatusBox>
      ) : connectionTestError ? (
        <StatusBox variant="error" title={connectionTestError.summary}>
          {connectionTestError.details.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
              {connectionTestError.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </StatusBox>
      ) : isConnected ? (
        <StatusBox variant="success" title="Connected">
          The function responds and authenticates.
        </StatusBox>
      ) : persistedError && hasSavedUrl ? (
        <StatusBox variant="error" title="Connection failed">
          {persistedError}
          {connectionErrorDetails.length > 0 && (
            <div style={{ marginTop: 'var(--spacing-s)' }}>
              <Button
                buttonType="muted"
                buttonSize="xs"
                onClick={() => setShowDetails((current) => !current)}
              >
                {showDetails ? 'Hide details' : 'Show details'}
              </Button>
              {showDetails && (
                <ul style={{ margin: 'var(--spacing-s) 0 0', paddingLeft: '1.2em' }}>
                  {connectionErrorDetails.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </StatusBox>
      ) : null}
    </>
  );
};
