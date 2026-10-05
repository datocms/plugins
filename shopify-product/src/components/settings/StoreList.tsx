import { Section } from 'datocms-react-ui';
import { useEffect } from 'react';
import { connectionSignature, type StoreDraft } from './draft';
import StoreFields from './StoreFields';
import styles from './StoreList.module.css';
import type { SettingsForm } from './useSettingsForm';

type Props = {
  form: SettingsForm;
  locale: string;
};

/** What a store block shows about its connection, derived from the checks. */
function connectionView(form: SettingsForm, store: StoreDraft) {
  const signature = connectionSignature(store);
  const status = signature ? form.checks.statuses[signature] : undefined;
  const detected = status?.kind === 'connected' && status.detected;
  // Saved capabilities describe the saved connection only.
  const trusted =
    detected ||
    (signature !== null && form.savedSignatures.get(store.key) === signature);
  return {
    status,
    capabilities: trusted ? store.capabilities : null,
    localization:
      status?.kind === 'connected' ? status.result.localization : null,
    canSaveAnyway:
      signature !== null &&
      status?.kind === 'failed' &&
      form.saveAnywaySignatures.has(signature),
  };
}

/** The "Shopify store(s)" section: one block per store. */
export default function StoreList({ form, locale }: Props) {
  const { stores } = form.draft;
  const multiple = stores.length > 1;

  useEffect(() => {
    if (!form.focusRequest) return;
    document.getElementById(`${form.focusRequest.storeKey}-domain`)?.focus();
  }, [form.focusRequest]);

  return (
    <Section
      title={multiple ? 'Shopify stores' : 'Shopify store'}
      titleClassName="dl-section-parity"
      headerStyle={{ marginBottom: 'var(--spacing-m)' }}
    >
      <div className={styles.stores}>
        {stores.map((store, index) => {
          const view = connectionView(form, store);
          return (
            <StoreFields
              key={store.key}
              store={store}
              position={index + 1}
              multiple={multiple}
              errors={form.errors.stores[index] ?? {}}
              status={view.status}
              capabilities={view.capabilities}
              localization={view.localization}
              locale={locale}
              locked={form.fieldsLocked}
              busy={form.saving}
              readOnly={form.readOnly}
              demoStore={form.draft.useDemoStore}
              onChange={(patch) => form.updateStore(store.key, patch)}
              onBlur={(field) => form.touchStore(store.key, field)}
              onTest={() => void form.testStore(store.key)}
              onMakeDefault={() => void form.makeDefault(store.key)}
              onRemove={() => void form.removeStore(store.key)}
              onSaveAnyway={
                view.canSaveAnyway ? () => void form.saveAnyway() : undefined
              }
            />
          );
        })}
      </div>
    </Section>
  );
}
