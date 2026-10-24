import Button from 'datocms-react-ui/Button';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { useCopyToClipboard } from 'datocms-react-ui/hooks/useCopyToClipboard';
import { Page, type PageGroupProps } from 'datocms-react-ui/Page';
import SettingsList from 'datocms-react-ui/SettingsList';
import StringInput from 'datocms-react-ui/StringInput';
import { DEPLOY_PROVIDER_OPTIONS } from '../utils/deployProviders';
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

const getRemoveReason = (config: BackupsConfig) => {
  if (!config.canEdit) {
    return READ_ONLY_REASON;
  }
  return config.isBusy && !config.isDisconnecting ? BUSY_REASON : undefined;
};

const getSaveReason = (config: BackupsConfig) => {
  if (!config.canEdit) {
    return READ_ONLY_REASON;
  }
  if (config.isBusy && !config.isSavingDeployment) {
    return BUSY_REASON;
  }
  return config.urlInput.trim() ? undefined : 'Enter the deployment URL first.';
};

/** Step 2: deploy the backup service and save its public URL. */
export const StepDeploy = ({ config, group }: Props) => {
  const {
    canEdit,
    isBusy,
    urlInput,
    setUrlInput,
    saveDeploymentUrl,
    removeDeployment,
    deploymentUrlError,
    isSavingDeployment,
    isDisconnecting,
    savedUrl,
    savedSecret,
  } = config;

  const { copied, copy } = useCopyToClipboard(savedSecret);
  const readOnly = canEdit ? false : { reason: READ_ONLY_REASON };
  const removeReason = getRemoveReason(config);
  const saveReason = getSaveReason(config);

  return (
    <Page.Group
      title="2. Deploy the backup service"
      {...group}
      footer={
        <div className={styles.buttons}>
          {savedUrl.trim().length > 0 && (
            <Button
              tone="ghost-alert"
              label="Remove saved deployment"
              busy={isDisconnecting}
              onClick={() => {
                void removeDeployment();
              }}
              disabled={removeReason ? { reason: removeReason } : false}
            />
          )}
          <Button
            tone="primary"
            label="Save URL & continue"
            className={styles.end}
            busy={isSavingDeployment}
            onClick={() => {
              void saveDeploymentUrl();
            }}
            disabled={saveReason ? { reason: saveReason } : false}
          />
        </div>
      }
    >
      <SettingsList className={styles.block}>
        <SettingsList.Row
          title="API token"
          description={
            <>
              Add a full-access API token as{' '}
              <code>DATOCMS_FULLACCESS_API_TOKEN</code>.
            </>
          }
          action={
            <Button
              tone="ghost"
              label="Open API tokens"
              to="/project_settings/access_tokens"
              disabled={readOnly}
            />
          }
        />
        <SettingsList.Row
          title="Shared secret"
          description={
            <>
              Add the secret from step 1 as <code>CRON_SECRET</code> on Vercel,
              or as <code>DATOCMS_BACKUPS_SHARED_SECRET</code> on Netlify or
              Cloudflare.
            </>
          }
          action={
            <Button
              tone="ghost"
              label={copied ? 'Copied' : 'Copy secret'}
              onClick={copy}
              disabled={readOnly}
            />
          }
        />
      </SettingsList>
      <div className={`${styles.buttons} ${styles.block}`}>
        {DEPLOY_PROVIDER_OPTIONS.map((option) => (
          <Button
            key={option.provider}
            label={`Deploy to ${option.label}`}
            href={option.url}
            newTab
            disabled={readOnly}
          />
        ))}
      </div>
      <FieldWrapper
        label="Deployment URL"
        error={deploymentUrlError ?? undefined}
      >
        <StringInput
          type="url"
          code
          value={urlInput}
          onChange={(value) => setUrlInput(value ?? '')}
          placeholder="https://backups.example.com"
          autoComplete="url"
          spellCheck={false}
          disabled={!canEdit || isBusy}
        />
      </FieldWrapper>
    </Page.Group>
  );
};
