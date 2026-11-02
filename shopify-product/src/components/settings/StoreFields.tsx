import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import type { Message } from 'datocms-react-ui/Message';
import StringInput from 'datocms-react-ui/StringInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { SETUP_DOCS_URL } from '../../constants';
import type { LocalizationInfo, StoreCapabilities } from '../../types';
import ConnectionStatus from './ConnectionStatus';
import {
  isBlankStore,
  type StoreDraft,
  type StoreErrors,
  type StoreFieldName,
  storeDomain,
} from './draft';
import MarketFields from './MarketFields';
import type { ConnectionStatus as Status } from './useConnectionChecks';

export type StoreFieldsProps = {
  store: StoreDraft;
  /** With two or more stores each store gets a label. */
  multiple: boolean;
  errors: StoreErrors;
  status: Status | undefined;
  /** Capabilities that belong to the current connection, if known. */
  capabilities: StoreCapabilities | null;
  localization: LocalizationInfo | null;
  locale: string;
  /** Inputs: locked after a second of saving, or for read-only roles. */
  locked: boolean;
  /** A role that can't edit the schema: text stays readable and copyable. */
  readOnly: boolean;
  /** A save is running: the connection check waits for it. */
  saving: boolean;
  /** While the demo store is on, a blank store is allowed (it isn't saved). */
  demoStore: boolean;
  onChange: (patch: Partial<StoreDraft>) => void;
  onBlur: (field: StoreFieldName) => void;
  onTest: () => void;
};

function domainHint(store: StoreDraft): Message {
  const domain = storeDomain(store);
  if (domain && store.domainInput.trim().toLowerCase() !== domain) {
    return (
      <>
        Connects to <strong>{domain}</strong>.
      </>
    );
  }
  return 'A Shopify admin URL works too.';
}

/**
 * A text input's lock: read-only for a role that can't change the settings
 * (the value stays selectable, to copy it), disabled only while saving.
 * Switches and selects have no read-only mode: they take `locked`.
 */
function textLock({ locked, readOnly }: StoreFieldsProps) {
  return { disabled: locked && !readOnly, readOnly };
}

/** A blank store is fine while the demo store is on: nothing is required. */
function isRequired({ store, demoStore }: StoreFieldsProps): boolean {
  return !(demoStore && isBlankStore(store));
}

/** The "Default" pill of the first store says which one fields use. */
function LabelField(props: StoreFieldsProps) {
  const { store, onChange } = props;
  return (
    <FieldWrapper id={`${store.key}-label`} label="Label">
      <StringInput
        name={`${store.key}-label`}
        placeholder="EU store"
        autoComplete="off"
        value={store.label}
        {...textLock(props)}
        onChange={(label) => onChange({ label: label ?? '' })}
      />
    </FieldWrapper>
  );
}

function DomainField(props: StoreFieldsProps) {
  const { store, errors, onChange, onBlur } = props;
  return (
    <FieldWrapper
      id={`${store.key}-domain`}
      label="Shop domain"
      required={isRequired(props)}
      hint={domainHint(store)}
      error={errors.domain}
    >
      <StringInput
        name={`${store.key}-domain`}
        placeholder="acme.myshopify.com"
        autoComplete="off"
        spellCheck={false}
        value={store.domainInput}
        {...textLock(props)}
        onChange={(domainInput) => onChange({ domainInput: domainInput ?? '' })}
        onBlur={() => onBlur('domain')}
      />
    </FieldWrapper>
  );
}

function TokenlessSwitch({ store, locked, onChange }: StoreFieldsProps) {
  return (
    <FieldWrapper
      id={`${store.key}-tokenless`}
      hint="Public stores only, without tag filters or stock levels."
    >
      <SwitchInput
        name={`${store.key}-tokenless`}
        label="Connect without a token"
        value={store.tokenless}
        disabled={locked}
        onChange={(tokenless) => onChange({ tokenless: Boolean(tokenless) })}
      />
    </FieldWrapper>
  );
}

function TokenField(props: StoreFieldsProps) {
  const { store, errors, onChange, onBlur } = props;
  return (
    <FieldWrapper
      id={`${store.key}-token`}
      label="Storefront access token"
      required={isRequired(props)}
      hint="From your Headless storefront in Shopify."
      docs={{ label: 'How to get one', to: SETUP_DOCS_URL }}
      error={errors.token}
    >
      <StringInput
        name={`${store.key}-token`}
        code
        autoComplete="off"
        spellCheck={false}
        value={store.token}
        {...textLock(props)}
        onChange={(token) => onChange({ token: token ?? '' })}
        onBlur={() => onBlur('token')}
      />
    </FieldWrapper>
  );
}

/**
 * The fields of one store connection: label, domain, token, default market,
 * then the result of its connection check.
 */
export default function StoreFields(props: StoreFieldsProps) {
  const { store, multiple, status, localization, locked } = props;

  return (
    <>
      {multiple && <LabelField {...props} />}
      <DomainField {...props} />
      <TokenlessSwitch {...props} />
      {!store.tokenless && <TokenField {...props} />}
      {/* While the connection is checked again, the last markets stay,
          disabled, so the form doesn't jump. */}
      {localization && (
        <MarketFields
          idPrefix={store.key}
          localization={localization}
          country={store.defaultCountry}
          language={store.defaultLanguage}
          locale={props.locale}
          disabled={locked || status?.kind === 'checking'}
          onChange={props.onChange}
        />
      )}
      {(status || store.domainInput.trim() !== '') && (
        <ConnectionStatus
          status={status}
          capabilities={props.capabilities}
          tokenless={store.tokenless}
          saving={props.saving}
          onTest={props.onTest}
        />
      )}
    </>
  );
}
