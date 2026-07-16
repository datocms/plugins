import { Button, Spinner, TextField } from 'datocms-react-ui';
import type { CSSProperties } from 'react';
import { StatusBox } from './StatusBox';
import { StepActionArrow } from './StepActionArrow';
import styles from './StepContent.module.css';
import type { BackupsConfig } from './useBackupsConfig';

const RegenerateIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const linkButtonStyle: CSSProperties = {
  border: 0,
  background: 'transparent',
  padding: 0,
  margin: 0,
  color: 'inherit',
  font: 'inherit',
  fontWeight: 'var(--font-weight-bold)',
  textDecoration: 'underline',
  cursor: 'pointer',
};

/** Step 1 — generate, save, and copy the shared deployment secret. */
export const StepSecret = ({ config }: { config: BackupsConfig }) => {
  const {
    canEdit,
    secretInput,
    setSecretInput,
    saveAndCopySecret,
    copySecret,
    regenerateSecret,
    revertSecret,
    isSavingSecret,
    savedSecret,
    isConnected,
  } = config;

  const trimmedInput = secretInput.trim();
  const hasSavedSecret = savedSecret.trim().length > 0;
  const hasUnsavedChanges = trimmedInput !== savedSecret.trim();
  const secretEdited = hasSavedSecret && hasUnsavedChanges;

  return (
    <>
      <div className={styles.compactField} data-step-interactive>
        <TextField
          name="lambdaAuthSecret"
          id="lambdaAuthSecret"
          label="Shared secret"
          hint="You will add this value to the deployment in the next step."
          value={secretInput}
          placeholder="Generate a strong secret"
          onChange={setSecretInput}
          textInputProps={{
            autoComplete: 'off',
            disabled: !canEdit || isSavingSecret,
            monospaced: true,
            spellCheck: false,
          }}
        />
      </div>

      {secretEdited && (
        <StatusBox variant="warning">
          {isConnected ? (
            <>
              Saving this secret means updating{' '}
              <code>DATOCMS_BACKUPS_SHARED_SECRET</code> on your deployment.{' '}
            </>
          ) : (
            <>This secret has not been saved yet. </>
          )}
          <button
            type="button"
            onClick={revertSecret}
            style={linkButtonStyle}
            disabled={!canEdit}
          >
            Revert to saved
          </button>
        </StatusBox>
      )}

      <div className={styles.stepFooter}>
        <div className={styles.stepFooterSecondary}>
          {!hasUnsavedChanges && hasSavedSecret && (
            <Button
              buttonType="muted"
              buttonSize="s"
              onClick={() => {
                void copySecret();
              }}
              disabled={!canEdit || trimmedInput.length === 0}
            >
              Copy secret
            </Button>
          )}

          <Button
            buttonType="muted"
            buttonSize="s"
            onClick={regenerateSecret}
            disabled={!canEdit || isSavingSecret}
            leftIcon={<RegenerateIcon />}
          >
            Generate new
          </Button>
        </div>

        {(hasUnsavedChanges || !hasSavedSecret) && (
          <div className={styles.stepFooterPrimary}>
            <Button
              buttonType="primary"
              buttonSize="s"
              onClick={() => {
                void saveAndCopySecret();
              }}
              disabled={!canEdit || isSavingSecret || trimmedInput.length === 0}
              leftIcon={isSavingSecret ? <Spinner size={16} /> : undefined}
              rightIcon={!isSavingSecret ? <StepActionArrow /> : undefined}
            >
              {isSavingSecret ? 'Saving…' : 'Save secret & continue'}
            </Button>
          </div>
        )}
      </div>
    </>
  );
};
