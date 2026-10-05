import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, FieldError, Form, Spinner } from 'datocms-react-ui';
import { useState } from 'react';
import AdvancedSettings from '../components/settings/AdvancedSettings';
import { StableButton } from '../components/settings/StableButton';
import StoreList from '../components/settings/StoreList';
import {
  type FormMessage,
  type SettingsForm,
  useSettingsForm,
} from '../components/settings/useSettingsForm';
import Callout from '../components/shared/Callout';
import styles from './ConfigScreen.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

const FORM_MESSAGES: Record<FormMessage, string> = {
  invalid: 'Fix the errors above before saving',
  connection:
    "Couldn't connect to Shopify. Fix the connection above, or save anyway.",
};

const API_VERSION_MESSAGE =
  'This plugin version targets an expired Shopify API version. Update the plugin to keep it working.';

/** Nothing to save, a save running, or a read-only role. */
function isSaveUnavailable(form: SettingsForm): boolean {
  return !form.dirty || form.saving || form.readOnly;
}

/**
 * Unavailable rather than disabled: pressing Save (or a save finishing with
 * nothing left to save) keeps keyboard focus on it.
 */
function SaveButton({ form }: { form: SettingsForm }) {
  return (
    <StableButton
      type="submit"
      buttonType="primary"
      buttonSize="xl"
      fullWidth
      unavailable={isSaveUnavailable(form)}
    >
      {form.saving ? (
        <span className={styles.pending}>
          Please wait
          <Spinner size={20} />
        </span>
      ) : (
        'Save settings'
      )}
    </StableButton>
  );
}

function SettingsScreen({ ctx }: Props) {
  const form = useSettingsForm(ctx);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // An error in a closed section would be invisible: it opens the section,
  // which stays open once fixed (it would close under the user's cursor).
  const autoApplyError = Boolean(form.errors.autoApply);
  if (autoApplyError && !advancedOpen) setAdvancedOpen(true);
  const advancedShown = advancedOpen || autoApplyError;

  return (
    <div className="dl-kit-form-parity">
      <Form
        onSubmit={() => {
          // Enter in a field submits too.
          if (!isSaveUnavailable(form)) void form.save();
        }}
      >
        {form.readOnly && (
          <Callout tone="neutral" role="status">
            Your role can view these settings but can't change them
          </Callout>
        )}
        {form.draft.useDemoStore && (
          <Callout tone="neutral" role="status">
            The demo store is on, so editors browse sample products. Switch it
            off in Advanced settings.
          </Callout>
        )}
        {form.checks.apiVersionOutdated && (
          <Callout tone="warning" role="alert">
            {API_VERSION_MESSAGE}
          </Callout>
        )}
        <div className="dl-kit-sections">
          <StoreList form={form} locale={ctx.ui.locale} />
          <AdvancedSettings
            form={form}
            open={advancedShown}
            onToggle={() => {
              if (!autoApplyError) setAdvancedOpen(!advancedShown);
            }}
          />
        </div>
        {form.formMessage && (
          <div role="alert">
            <FieldError>{FORM_MESSAGES[form.formMessage]}</FieldError>
          </div>
        )}
        <SaveButton form={form} />
      </Form>
    </div>
  );
}

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <SettingsScreen ctx={ctx} />
    </Canvas>
  );
}
