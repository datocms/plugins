import { Button, Spinner, TextField } from 'datocms-react-ui';
import { DEPLOY_PROVIDER_OPTIONS } from '../utils/deployProviders';
import { StepActionArrow } from './StepActionArrow';
import styles from './StepContent.module.css';
import type { BackupsConfig } from './useBackupsConfig';

/** Step 2 — deploy the backup service and save its public URL. */
export const StepDeploy = ({ config }: { config: BackupsConfig }) => {
  const {
    canEdit,
    urlInput,
    setUrlInput,
    saveDeploymentUrl,
    removeDeployment,
    copySavedSecret,
    onOpenAccessTokens,
    deploymentUrlError,
    isSavingDeployment,
    isDisconnecting,
    savedUrl,
  } = config;

  const hasSavedUrl = savedUrl.trim().length > 0;
  const trimmedUrl = urlInput.trim();

  return (
    <>
      <p className={styles.savedUrl}>
        Add these two environment variables at your hosting provider before
        deploying:
      </p>

      <div className={styles.environmentVariables}>
        <div className={styles.environmentVariable}>
          <div>
            <code>DATOCMS_FULLACCESS_API_TOKEN</code>
            <p>A DatoCMS API token with full-access permissions.</p>
          </div>
          <Button
            buttonType="muted"
            buttonSize="xs"
            onClick={() => {
              void onOpenAccessTokens();
            }}
            disabled={!canEdit}
          >
            Open API tokens
          </Button>
        </div>

        <div className={styles.environmentVariable}>
          <div>
            <code>DATOCMS_BACKUPS_SHARED_SECRET</code>
            <p>The saved secret from step 1.</p>
          </div>
          <Button
            buttonType="muted"
            buttonSize="xs"
            onClick={() => {
              void copySavedSecret();
            }}
            disabled={!canEdit}
          >
            Copy secret
          </Button>
        </div>
      </div>

      <div className={styles.actions} aria-label="Deployment providers">
        {DEPLOY_PROVIDER_OPTIONS.map((option) => (
          <Button
            key={option.provider}
            buttonType="muted"
            buttonSize="s"
            onClick={() => {
              window.open(option.url, '_blank', 'noopener,noreferrer');
            }}
            disabled={!canEdit}
          >
            Deploy to {option.label}
          </Button>
        ))}
      </div>

      <div className={styles.compactField} data-step-interactive>
        <TextField
          name="deploymentURL"
          id="deploymentURL"
          label="Deployment URL"
          error={deploymentUrlError || undefined}
          value={urlInput}
          placeholder="https://backups.example.com"
          onChange={setUrlInput}
          textInputProps={{
            autoComplete: 'url',
            disabled: !canEdit || isSavingDeployment || isDisconnecting,
            spellCheck: false,
            type: 'url',
          }}
        />
      </div>

      <div className={styles.stepFooter}>
        <div className={styles.stepFooterSecondary}>
          {hasSavedUrl && (
            <Button
              buttonType="negative"
              buttonSize="s"
              onClick={() => {
                void removeDeployment();
              }}
              disabled={!canEdit || isSavingDeployment || isDisconnecting}
            >
              {isDisconnecting ? 'Removing…' : 'Remove saved deployment'}
            </Button>
          )}
        </div>

        <div className={styles.stepFooterPrimary}>
          <Button
            buttonType="primary"
            buttonSize="s"
            onClick={() => {
              void saveDeploymentUrl();
            }}
            disabled={
              !canEdit ||
              isSavingDeployment ||
              isDisconnecting ||
              trimmedUrl.length === 0
            }
            leftIcon={isSavingDeployment ? <Spinner size={16} /> : undefined}
            rightIcon={!isSavingDeployment ? <StepActionArrow /> : undefined}
          >
            {isSavingDeployment ? 'Saving…' : 'Save URL & continue'}
          </Button>
        </div>
      </div>
    </>
  );
};
