import Button from 'datocms-react-ui/Button';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { useCopyToClipboard } from 'datocms-react-ui/hooks/useCopyToClipboard';
import { Page, type PageCollapse } from 'datocms-react-ui/Page';
import StringInput from 'datocms-react-ui/StringInput';
import type { ReactNode } from 'react';
import { DEPLOY_PROVIDER_OPTIONS } from '../utils/deployProviders';
import styles from './StepContent.module.css';
import {
  type BackupsConfig,
  BUSY_REASON,
  READ_ONLY_REASON,
} from './useBackupsConfig';

type Props = {
  config: BackupsConfig;
  section: { status?: ReactNode; collapse: PageCollapse };
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
export const StepDeploy = ({ config, section }: Props) => {
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
    <Page.Section>
      <Page.SectionTitle collapse={section.collapse}>
        2. Deploy the backup service {section.status}
      </Page.SectionTitle>
      {section.collapse.open && (
        <>
          <Page.SectionDescription>
            <p>
              Add a full-access API token as{' '}
              <code>DATOCMS_FULLACCESS_API_TOKEN</code>.
            </p>
            <p>
              Add the secret from step 1 as <code>CRON_SECRET</code> on Vercel,
              or as <code>DATOCMS_BACKUPS_SHARED_SECRET</code> on Netlify or
              Cloudflare.
            </p>
          </Page.SectionDescription>
          <div className={`${styles.buttons} ${styles.block}`}>
            <Button
              label="Open API tokens"
              to="/project_settings/access_tokens"
              disabled={readOnly}
            />
            <Button
              label={copied ? 'Copied' : 'Copy secret'}
              onClick={copy}
              disabled={readOnly}
            />
          </div>
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
          <div className={styles.buttons}>
            <Button
              tone="primary"
              label="Save URL & continue"
              busy={isSavingDeployment}
              onClick={() => {
                void saveDeploymentUrl();
              }}
              disabled={saveReason ? { reason: saveReason } : false}
            />
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
          </div>
        </>
      )}
    </Page.Section>
  );
};
