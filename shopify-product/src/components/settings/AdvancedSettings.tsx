import Button from 'datocms-react-ui/Button';
import FieldHint from 'datocms-react-ui/FieldHint';
import { Page } from 'datocms-react-ui/Page';
import { PlusIcon } from '../../icons';
import AutoApplySection from './AutoApplySection';
import DemoStoreSection from './DemoStoreSection';
import { SAVING_REASON } from './focus';
import styles from './Settings.module.css';
import type { SettingsForm } from './useSettingsForm';

type Props = {
  form: SettingsForm;
  open: boolean;
  onToggle: () => void;
};

const ADD_STORE_HINT_ID = 'add-store-hint';

/** Everything most projects never touch: more stores, the demo store, auto-apply. */
export default function AdvancedSettings({ form, open, onToggle }: Props) {
  // An error must stay visible: the group can't close while it shows.
  const collapse = form.errors.autoApply ? { open: true } : { open, onToggle };

  return (
    <Page.Group title="Advanced settings" collapse={collapse}>
      {!form.readOnly && (
        <div className={styles.block}>
          <Button
            icon={PlusIcon}
            label="Add another store"
            aria-describedby={ADD_STORE_HINT_ID}
            disabled={form.saving ? { reason: SAVING_REASON } : undefined}
            onClick={form.addStore}
          />
          <FieldHint
            id={ADD_STORE_HINT_ID}
            hint="Each field can then pick which store it uses."
          />
        </div>
      )}
      <DemoStoreSection
        value={form.draft.useDemoStore}
        disabled={form.fieldsLocked}
        onChange={form.setUseDemoStore}
      />
      <AutoApplySection
        value={form.draft.autoApplyToFieldsWithApiKey}
        error={form.errors.autoApply}
        disabled={form.fieldsLocked && !form.readOnly}
        readOnly={form.readOnly}
        onChange={form.setAutoApply}
        onBlur={form.touchAutoApply}
      />
    </Page.Group>
  );
}
