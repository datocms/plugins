import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import { Page } from 'datocms-react-ui/Page';
import Pill from 'datocms-react-ui/Pill';
import { type FormEvent, useRef, useState } from 'react';
import AdvancedSettings from '../components/settings/AdvancedSettings';
import { connectionSignature } from '../components/settings/draft';
import { SAVING_REASON, useFocusAfterBusy } from '../components/settings/focus';
import styles from '../components/settings/Settings.module.css';
import StoreList from '../components/settings/StoreList';
import {
  type FormMessage,
  type SettingsForm,
  useSettingsForm,
} from '../components/settings/useSettingsForm';

type Props = {
  ctx: RenderConfigScreenCtx;
};

/** The message under the last group; one with more than a sentence gets a title. */
const FORM_MESSAGES: Record<FormMessage, { title?: string; text: string }> = {
  invalid: { text: 'Fix the errors above before saving.' },
  connection: {
    title: 'Settings not saved',
    text: 'Fix the connection above, or save anyway.',
  },
};

const API_VERSION_MESSAGE =
  'This plugin version targets an expired Shopify API version. Update the plugin to keep it working.';

/** Nothing to save, a save running, or a read-only role. */
function isSaveUnavailable(form: SettingsForm): boolean {
  return !form.dirty || form.saving || form.readOnly;
}

/** Why Save can't run; nothing while it runs (it is busy instead). */
function saveDisabled(form: SettingsForm, savingAnyway: boolean) {
  if (savingAnyway) return { reason: SAVING_REASON };
  if (!form.dirty && !form.saving) {
    return { reason: 'There are no changes to save.' };
  }
  return undefined;
}

/** A store whose check failed during the last save: Save anyway skips it. */
function canSaveAnyway(form: SettingsForm): boolean {
  return form.draft.stores.some((store) => {
    const signature = connectionSignature(store);
    return (
      signature !== null &&
      form.saveAnywaySignatures.has(signature) &&
      form.checks.statuses[signature]?.kind === 'failed'
    );
  });
}

function SettingsScreen({ ctx }: Props) {
  const form = useSettingsForm(ctx);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // An error in a closed group would be invisible: it opens the group, which
  // stays open once fixed (it would close under the user's cursor).
  const autoApplyError = Boolean(form.errors.autoApply);
  if (autoApplyError && !advancedOpen) setAdvancedOpen(true);
  const advancedShown = advancedOpen || autoApplyError;
  // Save is busy for its own save; Save anyway for the one it starts.
  const [savingAnyway, setSavingAnyway] = useState(false);
  const savingAnywayRef = useRef(false);
  const save = useFocusAfterBusy(form.saving);
  const saveAnyway = useFocusAfterBusy(form.saving, save.ref);

  const handleSaveAnyway = async () => {
    // A double click saves once (the form ignores the second save too).
    if (savingAnywayRef.current) return;
    savingAnywayRef.current = true;
    saveAnyway.follow();
    setSavingAnyway(true);
    try {
      await form.saveAnyway();
    } finally {
      savingAnywayRef.current = false;
      setSavingAnyway(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Enter in a field submits too.
    if (isSaveUnavailable(form)) return;
    save.follow();
    void form.save();
  };

  return (
    <Page>
      <Page.Content>
        <form onSubmit={handleSubmit}>
          {form.checks.apiVersionOutdated && (
            <Page.Group
              title="Shopify API version"
              tone="warning"
              status={<Pill tone="warning">Expired</Pill>}
            >
              <Callout tone="warning">{API_VERSION_MESSAGE}</Callout>
            </Page.Group>
          )}
          {form.readOnly && (
            <Callout>
              Your role can view these settings but can't change them.
            </Callout>
          )}
          {form.draft.useDemoStore && (
            <Callout title="Demo store on">
              Editors browse sample products until you switch it off in Advanced
              settings.
            </Callout>
          )}
          <StoreList form={form} locale={ctx.ui.locale} />
          <AdvancedSettings
            form={form}
            open={advancedShown}
            onToggle={() => setAdvancedOpen(!advancedShown)}
          />
          {form.formMessage && (
            <Callout
              tone="danger"
              title={FORM_MESSAGES[form.formMessage].title}
            >
              {FORM_MESSAGES[form.formMessage].text}
            </Callout>
          )}
          {/* One form spans every group, so Save follows the last one. A
              role that can't change the settings has nothing to save (the
              callout at the top says so). */}
          {!form.readOnly && (
            <div className={styles.actions}>
              <Button
                ref={save.ref}
                submit
                tone="primary"
                label="Save"
                busy={form.saving && !savingAnyway}
                disabled={saveDisabled(form, savingAnyway)}
              />
              {canSaveAnyway(form) && (
                <Button
                  ref={saveAnyway.ref}
                  label="Save anyway"
                  busy={savingAnyway}
                  disabled={
                    form.saving && !savingAnyway
                      ? { reason: SAVING_REASON }
                      : undefined
                  }
                  onClick={handleSaveAnyway}
                />
              )}
            </div>
          )}
        </form>
      </Page.Content>
    </Page>
  );
}

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <SettingsScreen ctx={ctx} />
    </Canvas>
  );
}
