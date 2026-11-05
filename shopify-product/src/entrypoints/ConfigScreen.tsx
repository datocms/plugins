import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
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

/**
 * The message under the last section: one sentence, the cause is above. Field
 * errors have none: each shows under its field, which takes the focus.
 */
const FORM_MESSAGES: Record<FormMessage, string> = {
  connection:
    "The settings weren't saved: fix the connection above, or save anyway.",
};

const API_VERSION_MESSAGE =
  'Shopify no longer supports the version this plugin uses. Update the plugin from the plugins list to keep it working.';

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
  // An error in a closed section would be invisible: it opens the section,
  // which stays open once fixed (it would close under the user's cursor).
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

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the store starts the frame, with no
  // Page around it, under the callouts about the current settings
  return (
    <form onSubmit={handleSubmit}>
      {form.checks.apiVersionOutdated && (
        <Callout tone="warning" title="Shopify API version expired">
          {API_VERSION_MESSAGE}
        </Callout>
      )}
      {form.readOnly && (
        <Callout>
          Your role can view these settings but can't change them.
        </Callout>
      )}
      {form.draft.useDemoStore && (
        <Callout>
          The demo store is on: editors browse sample products until you switch
          it off in Advanced settings.
        </Callout>
      )}
      <StoreList form={form} locale={ctx.ui.locale} />
      <AdvancedSettings
        form={form}
        open={advancedShown}
        onToggle={() => setAdvancedOpen(!advancedShown)}
      />
      {form.formMessage && (
        <Callout tone="danger">{FORM_MESSAGES[form.formMessage]}</Callout>
      )}
      {/* One form spans the stores and Advanced settings, so Save follows
          the last section. A role that can't change the settings has nothing
          to save (the callout at the top says so). */}
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
              tone="ghost"
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
  );
}

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <SettingsScreen ctx={ctx} />
    </Canvas>
  );
}
