import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { useCopyToClipboard } from 'datocms-react-ui/hooks/useCopyToClipboard';
import { Page, type PageCollapse } from 'datocms-react-ui/Page';
import StringInput from 'datocms-react-ui/StringInput';
import type { ReactNode } from 'react';
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

const getSaveReason = (config: BackupsConfig, secret: string) => {
  if (!config.canEdit) {
    return READ_ONLY_REASON;
  }
  if (config.isBusy && !config.isSavingSecret) {
    return BUSY_REASON;
  }
  return secret ? undefined : 'Enter or generate a secret first.';
};

/** Step 1: generate, save and copy the shared deployment secret. */
export const StepSecret = ({ config, section }: Props) => {
  const {
    canEdit,
    isBusy,
    secretInput,
    setSecretInput,
    saveAndCopySecret,
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
  const { copied, copy } = useCopyToClipboard(trimmedInput);

  const readOnly = canEdit ? false : { reason: READ_ONLY_REASON };
  const generateReason = canEdit ? isBusy && BUSY_REASON : READ_ONLY_REASON;
  const saveReason = getSaveReason(config, trimmedInput);

  return (
    <Page.Section>
      <Page.SectionTitle collapse={section.collapse}>
        1. Create a secret {section.status}
      </Page.SectionTitle>
      {section.collapse.open && (
        <>
          <FieldWrapper
            label="Shared secret"
            hint="You add this value to your deployment in the next step."
          >
            <StringInput
              code
              value={secretInput}
              onChange={(value) => setSecretInput(value ?? '')}
              autoComplete="off"
              spellCheck={false}
              disabled={!canEdit || isBusy}
            />
          </FieldWrapper>
          {secretEdited && (
            <Callout tone="warning">
              {isConnected ? (
                <>
                  Saving this secret means updating{' '}
                  <code>DATOCMS_BACKUPS_SHARED_SECRET</code> on your deployment.
                </>
              ) : (
                "This secret isn't saved yet."
              )}
            </Callout>
          )}
          <div className={styles.buttons}>
            {(hasUnsavedChanges || !hasSavedSecret) && (
              <Button
                tone="primary"
                label="Save secret & continue"
                busy={isSavingSecret}
                onClick={() => {
                  void saveAndCopySecret();
                }}
                disabled={saveReason ? { reason: saveReason } : false}
              />
            )}
            {!hasUnsavedChanges && hasSavedSecret && (
              <Button
                label={copied ? 'Copied' : 'Copy secret'}
                onClick={copy}
                disabled={readOnly}
              />
            )}
            <Button
              label="Generate new"
              onClick={regenerateSecret}
              disabled={generateReason ? { reason: generateReason } : false}
            />
            {secretEdited && (
              <Button
                tone="ghost"
                label="Revert to saved"
                onClick={revertSecret}
                disabled={readOnly}
              />
            )}
          </div>
        </>
      )}
    </Page.Section>
  );
};
