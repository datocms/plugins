import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { FieldHint, Section } from 'datocms-react-ui';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import AutoApplySection from './AutoApplySection';
import DemoStoreSection from './DemoStoreSection';
import styles from './Disclosure.module.css';
import type { SettingsForm } from './useSettingsForm';

export const ADVANCED_TOGGLE_ID = 'shopify-advanced-settings-toggle';

type Props = {
  form: SettingsForm;
  open: boolean;
  onToggle: () => void;
};

/** Everything most projects never touch: more stores, the demo store, auto-apply. */
export default function AdvancedSettings({ form, open, onToggle }: Props) {
  const contentId = 'shopify-advanced-settings';
  return (
    <Section
      title={
        <button
          id={ADVANCED_TOGGLE_ID}
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={contentId}
        >
          Advanced settings
        </button>
      }
      titleClassName="dl-section-parity"
      headerStyle={{ marginBottom: open ? 'var(--spacing-m)' : 0 }}
      collapsible={{ isOpen: open, onToggle }}
    >
      <div id={contentId} className={styles.panel}>
        {!form.readOnly && (
          <div>
            <Button
              buttonSize="xs"
              leftIcon={<Icon icon={faPlus} />}
              disabled={form.saving}
              onClick={form.addStore}
            >
              Add another store
            </Button>
            <FieldHint>Each field can then pick which store it uses</FieldHint>
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
          disabled={form.fieldsLocked}
          onChange={form.setAutoApply}
          onBlur={form.touchAutoApply}
        />
      </div>
    </Section>
  );
}
