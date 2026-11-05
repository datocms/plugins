import CardList from 'datocms-react-ui/CardList';
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

/**
 * The fields of the store; with several, a card with an item per store, each
 * with its name, the "Default" pill of the first one and a "⋮" menu.
 */
export default function StoreList({ form, locale }: Props) {
  const { stores } = form.draft;
  const multiple = stores.length > 1;

  useEffect(() => {
    if (!form.focusRequest) return;
    document.getElementById(`${form.focusRequest.storeKey}-domain`)?.focus();
  }, [form.focusRequest]);

  const fields = (store: StoreDraft, index: number) => {
    const view = connectionView(form, store);
    return (
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
    );
  };

  // The only store: its fields start the screen, with no title
  const [only] = stores;
  if (!multiple && only) return fields(only, 0);

  return (
    <CardList>
      {stores.map((store, index) => {
        const position = index + 1;
        const name = storeDisplayName(store) || `Store ${position}`;
        return (
          <CardList.Item
            key={store.key}
            row={{
              summary: name,
              trailing: position === 1 ? <Pill>Default</Pill> : undefined,
              actions: form.readOnly ? undefined : (
                <StoreMenu
                  name={name}
                  isDefault={position === 1}
                  busy={form.saving}
                  onMakeDefault={() => form.makeDefault(store.key)}
                  onRemove={() => form.removeStore(store.key)}
                />
              ),
            }}
            body={fields(store, index)}
          />
        );
      })}
    </CardList>
  );
}
