import { faBook } from '@fortawesome/free-solid-svg-icons';
import {
  CaretDownIcon,
  CaretUpIcon,
  FieldGroup,
  SwitchField,
  TextField,
} from 'datocms-react-ui';
import { type ReactNode, useState } from 'react';
import { SETUP_DOCS_URL } from '../../constants';
import type { LocalizationInfo, StoreCapabilities } from '../../types';
import { Icon } from '../../ui/Icon';
import ConnectionStatus from './ConnectionStatus';
import disclosure from './Disclosure.module.css';
import {
  isBlankStore,
  type StoreDraft,
  type StoreErrors,
  type StoreFieldName,
  storeDomain,
} from './draft';
import MarketFields from './MarketFields';
import StoreMenu from './StoreMenu';
import styles from './StoreFields.module.css';
import type { ConnectionStatus as Status } from './useConnectionChecks';

export type StoreFieldsProps = {
  store: StoreDraft;
  /** 1-based position; 1 is the default store. */
  position: number;
  /** With two or more stores each block gets a header, a label and a menu. */
  multiple: boolean;
  errors: StoreErrors;
  status: Status | undefined;
  /** Capabilities that belong to the current connection, if known. */
  capabilities: StoreCapabilities | null;
  localization: LocalizationInfo | null;
  locale: string;
  /** Inputs: locked after a second of saving, or for read-only roles. */
  locked: boolean;
  /** A save is running: its buttons (checks, Save anyway, ⋮) wait for it. */
  busy: boolean;
  /** The role can't edit the schema: actions that change settings are hidden. */
  readOnly: boolean;
  /** While the demo store is on, a blank block is allowed (it isn't saved). */
  demoStore: boolean;
  onChange: (patch: Partial<StoreDraft>) => void;
  onBlur: (field: StoreFieldName) => void;
  onTest: () => void;
  onMakeDefault: () => void;
  onRemove: () => void;
  onSaveAnyway?: () => void;
};

/** `hint` and `error` with ids, plus the matching input attributes. */
function describe(id: string, hint: ReactNode, error: string | undefined) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return {
    hint: <span id={hintId}>{hint}</span>,
    error: error ? <span id={errorId}>{error}</span> : undefined,
    inputProps: {
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? `${errorId} ${hintId}` : hintId,
    },
  };
}

function domainHint(store: StoreDraft): ReactNode {
  const domain = storeDomain(store);
  if (domain && store.domainInput.trim().toLowerCase() !== domain) {
    return (
      <>
        Connects to <strong>{domain}</strong>
      </>
    );
  }
  return 'A Shopify admin URL works too';
}

function StoreHeader({
  id,
  position,
  busy,
  readOnly,
  onMakeDefault,
  onRemove,
}: {
  id: string;
  position: number;
  busy: boolean;
  readOnly: boolean;
  onMakeDefault: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={styles.header}>
      <span id={id} className={styles.microLabel}>
        Store {position}
        {position === 1 && ' · default'}
      </span>
      <span className={styles.rule} aria-hidden="true" />
      {!readOnly && (
        <StoreMenu
          position={position}
          isDefault={position === 1}
          disabled={busy}
          onMakeDefault={onMakeDefault}
          onRemove={onRemove}
        />
      )}
    </div>
  );
}

/** A blank block is fine while the demo store is on: nothing is required. */
function isRequired({ store, demoStore }: StoreFieldsProps): boolean {
  return !(demoStore && isBlankStore(store));
}

function DomainField(props: StoreFieldsProps) {
  const { store, errors, locked, onChange, onBlur } = props;
  const id = `${store.key}-domain`;
  const described = describe(id, domainHint(store), errors.domain);
  return (
    <TextField
      id={id}
      name={id}
      label="Shop domain"
      required={isRequired(props)}
      placeholder="acme.myshopify.com"
      value={store.domainInput}
      onChange={(domainInput) => onChange({ domainInput })}
      hint={described.hint}
      error={described.error}
      textInputProps={{
        ...described.inputProps,
        autoComplete: 'off',
        spellCheck: false,
        disabled: locked,
        onBlur: () => onBlur('domain'),
      }}
    />
  );
}

function TokenField(props: StoreFieldsProps) {
  const { store, errors, locked, onChange, onBlur } = props;
  const id = `${store.key}-token`;
  const described = describe(
    id,
    <>
      From your Headless storefront in Shopify.{' '}
      <a
        className={styles.guideLink}
        href={SETUP_DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon icon={faBook} className="dl-icon--current" />
        How to get one
      </a>
    </>,
    errors.token,
  );
  return (
    <TextField
      id={id}
      name={id}
      label="Storefront access token"
      required={isRequired(props)}
      value={store.token}
      onChange={(token) => onChange({ token })}
      hint={described.hint}
      error={described.error}
      textInputProps={{
        ...described.inputProps,
        monospaced: true,
        autoComplete: 'off',
        spellCheck: false,
        disabled: locked,
        onBlur: () => onBlur('token'),
      }}
    />
  );
}

function TokenlessSwitch({ store, locked, onChange }: StoreFieldsProps) {
  const id = `${store.key}-tokenless`;
  return (
    <SwitchField
      id={id}
      name={id}
      label="Connect without a token?"
      hint="Public stores only, without tags or inventory"
      value={store.tokenless}
      onChange={(tokenless) => onChange({ tokenless })}
      switchInputProps={{
        name: id,
        value: store.tokenless,
        disabled: locked,
      }}
    />
  );
}

function LabelField({ store, position, locked, onChange }: StoreFieldsProps) {
  const id = `${store.key}-label`;
  const hintId = `${id}-hint`;
  const isDefault = position === 1;
  return (
    <TextField
      id={id}
      name={id}
      label="Label"
      placeholder="EU store"
      hint={
        isDefault ? (
          <span id={hintId}>Fields that don't pick a store use this one</span>
        ) : undefined
      }
      value={store.label}
      onChange={(label) => onChange({ label })}
      textInputProps={{
        autoComplete: 'off',
        disabled: locked,
        'aria-describedby': isDefault ? hintId : undefined,
      }}
    />
  );
}

/**
 * The rarely needed per-store options. It starts closed, except for a
 * tokenless store: there the hidden token field needs its explanation.
 */
function MoreOptions(props: StoreFieldsProps) {
  const { store, localization, locked } = props;
  const [open, setOpen] = useState(store.tokenless);
  const panelId = `${store.key}-options`;
  const expanded = open || store.tokenless;
  return (
    <div className={disclosure.group}>
      <button
        type="button"
        className={disclosure.inline}
        aria-expanded={expanded}
        aria-controls={panelId}
        disabled={store.tokenless}
        onClick={() => setOpen((current) => !current)}
      >
        More options
        {expanded ? <CaretUpIcon /> : <CaretDownIcon />}
      </button>
      {expanded && (
        <div id={panelId} className={disclosure.panel}>
          <div>
            <TokenlessSwitch {...props} />
          </div>
          {localization && (
            <MarketFields
              idPrefix={store.key}
              localization={localization}
              country={store.defaultCountry}
              language={store.defaultLanguage}
              locale={props.locale}
              disabled={locked}
              onChange={props.onChange}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** One store connection: domain, token, status, then the other options. */
export default function StoreFields(props: StoreFieldsProps) {
  const { store, position, multiple, status } = props;
  const headerId = `${store.key}-header`;

  return (
    <div
      className={styles.store}
      role={multiple ? 'group' : undefined}
      aria-labelledby={multiple ? headerId : undefined}
    >
      {multiple && (
        <StoreHeader
          id={headerId}
          position={position}
          busy={props.busy}
          readOnly={props.readOnly}
          onMakeDefault={props.onMakeDefault}
          onRemove={props.onRemove}
        />
      )}
      <FieldGroup>
        {multiple && <LabelField {...props} />}
        <DomainField {...props} />
        {!store.tokenless && <TokenField {...props} />}
        {(status || store.domainInput.trim() !== '') && (
          <ConnectionStatus
            status={status}
            capabilities={props.capabilities}
            tokenless={store.tokenless}
            locale={props.locale}
            disabled={props.busy}
            onTest={props.onTest}
            onSaveAnyway={props.onSaveAnyway}
          />
        )}
        <MoreOptions {...props} />
      </FieldGroup>
    </div>
  );
}
