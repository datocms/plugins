import { Page } from 'datocms-react-ui/Page';
import Pill from 'datocms-react-ui/Pill';
import { useEffect } from 'react';
import {
  connectionSignature,
  type StoreDraft,
  storeDisplayName,
} from './draft';
import StoreFields from './StoreFields';
import StoreMenu from './StoreMenu';
import type { SettingsForm } from './useSettingsForm';

type Props = {
  form: SettingsForm;
  locale: string;
};

/** What a store shows about its connection, derived from the checks. */
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
      status?.kind === 'connected'
        ? status.result.localization
        : status?.kind === 'checking'
          ? status.localization
          : null,
  };
}

/** One group per store; with several, each has a name and a "⋮" menu. */
export default function StoreList({ form, locale }: Props) {
  const { stores } = form.draft;
  const multiple = stores.length > 1;

  useEffect(() => {
    if (!form.focusRequest) return;
    document.getElementById(`${form.focusRequest.storeKey}-domain`)?.focus();
  }, [form.focusRequest]);

  return (
    <>
      {stores.map((store, index) => {
        const position = index + 1;
        const view = connectionView(form, store);
        const name = storeDisplayName(store) || `Store ${position}`;
        return (
          <Page.Group
            key={store.key}
            title={multiple ? name : 'Shopify store'}
            status={multiple && position === 1 ? <Pill>Default</Pill> : null}
            actions={
              multiple && !form.readOnly ? (
                <StoreMenu
                  name={name}
                  isDefault={position === 1}
                  busy={form.saving}
                  onMakeDefault={() => form.makeDefault(store.key)}
                  onRemove={() => form.removeStore(store.key)}
                />
              ) : null
            }
          >
            <StoreFields
              store={store}
              multiple={multiple}
              errors={form.errors.stores[index] ?? {}}
              status={view.status}
              capabilities={view.capabilities}
              localization={view.localization}
              locale={locale}
              locked={form.fieldsLocked}
              readOnly={form.readOnly}
              saving={form.saving}
              demoStore={form.draft.useDemoStore}
              onChange={(patch) => form.updateStore(store.key, patch)}
              onBlur={(field) => form.touchStore(store.key, field)}
              onTest={() => void form.testStore(store.key)}
            />
          </Page.Group>
        );
      })}
    </>
  );
}
