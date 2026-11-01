import Button from 'datocms-react-ui/Button';
import { Dropdown, type DropdownHandle } from 'datocms-react-ui/Dropdown';
import IconTrigger from 'datocms-react-ui/Dropdown/triggers/IconTrigger';
import EntityRow from 'datocms-react-ui/EntityRow';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import Pill from 'datocms-react-ui/Pill';
import TextareaInput from 'datocms-react-ui/TextareaInput';
import Toolbar from 'datocms-react-ui/Toolbar';
import Tooltip from 'datocms-react-ui/Tooltip';
import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  useImperativeHandle,
  useRef,
} from 'react';
import type { FieldInfo } from '../../lib/recordContext';
import { AtIcon, BoltIcon, CloseIcon, SendIcon } from '../icons';
import s from './Composer.module.css';

/** The id of the message input: the sidebar focuses it through this id */
export const COMPOSER_INPUT_ID = 'prompt-dato-composer';

/** Moves the focus to the message input, once the composer has rendered */
export function focusComposer() {
  requestAnimationFrame(() =>
    document.getElementById(COMPOSER_INPUT_ID)?.focus(),
  );
}

const PENDING_APPROVAL = 'Approve or deny the pending change first.';

const AUTO_APPROVE_ON_HINT =
  'Changes run without your review until you turn it off.';
const AUTO_APPROVE_OFF_HINT =
  'Run every change of this chat without asking first.';

type Props = {
  text: string;
  onChange: (value: string | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => unknown;
  isSending: boolean;
  /** A change waits for a decision: the message waits too */
  hasPendingApproval: boolean;
  /** The fields added to the context of the chat */
  scopedFields: FieldInfo[];
  /** The fields that can still go in the context */
  unscopedFields: FieldInfo[];
  onAddScope: (fieldId: string) => void;
  onRemoveScope: (fieldId: string) => void;
  /** Opens the field picker from code (when the user types "@") */
  fieldPickerRef: Ref<DropdownHandle>;
  /** The provider can submit approval decisions (auto-approve applies) */
  supportsWriteApprovals: boolean;
  autoApproveEdits: boolean;
  onAutoApproveClick: () => void;
};

function sendDisabledReason(
  text: string,
  hasPendingApproval: boolean,
): { reason: string } | undefined {
  if (hasPendingApproval) return { reason: PENDING_APPROVAL };
  if (!text.trim()) return { reason: 'Write a message first.' };
  return undefined;
}

function fieldPickerDisabledReason(
  scopedFields: FieldInfo[],
  unscopedFields: FieldInfo[],
): { reason: string } | undefined {
  if (unscopedFields.length > 0) return undefined;
  return {
    reason:
      scopedFields.length > 0
        ? 'Every field is already in the context.'
        : 'This model has no fields.',
  };
}

/** What the chat gets besides the message: the record, and the added fields */
function ContextRow({
  scopedFields,
  onRemoveScope,
}: Pick<Props, 'scopedFields' | 'onRemoveScope'>) {
  return (
    <div role="group" aria-label="Context" className={s.context}>
      <Pill tooltip="Chat always gets this record.">This record</Pill>
      {scopedFields.map((field) => (
        <span key={field.id} className={s.scopedField}>
          <EntityRow layout="inline" title={`@${field.label}`} />
          <Button
            tone="ghost"
            size="micro"
            iconOnly
            icon={CloseIcon}
            label={`Remove ${field.label} from the context`}
            onClick={() => onRemoveScope(field.id)}
          />
        </span>
      ))}
    </div>
  );
}

/** The event comes from the box of the trigger, not from the menu */
function isFromTrigger(event: KeyboardEvent | MouseEvent): boolean {
  // The menu renders in a portal: its events reach the box through React
  // only, thus the box contains the target only for the trigger
  return (
    event.target instanceof Node && event.currentTarget.contains(event.target)
  );
}

/** The keys that close the menu: Escape and Tab, with no modifier */
function closesMenu(event: KeyboardEvent): boolean {
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }
  return event.key === 'Escape' || event.key === 'Tab';
}

/**
 * The field picker: adds a field of the model to the context. Its search
 * field takes the focus. Opened by typing "@" (the `open()` of
 * `fieldPickerRef`), it gives the focus back to the message when it closes
 * with Escape or Tab, thus the user goes on typing. Opened with its button,
 * it gives the focus back to the button, as every menu does.
 */
function FieldPicker({
  scopedFields,
  unscopedFields,
  onAddScope,
  fieldPickerRef,
}: Pick<
  Props,
  'scopedFields' | 'unscopedFields' | 'onAddScope' | 'fieldPickerRef'
>) {
  const dropdownRef = useRef<DropdownHandle>(null);
  const openedFromMessageRef = useRef(false);

  useImperativeHandle(
    fieldPickerRef,
    () => ({
      open: () => {
        openedFromMessageRef.current = true;
        dropdownRef.current?.open();
      },
    }),
    [],
  );

  const handleMouseDownCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (isFromTrigger(event)) openedFromMessageRef.current = false;
  };

  // The capture runs before the menu handles the key: the menu then focuses
  // its button and closes, and the message takes the focus after it
  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isFromTrigger(event)) {
      openedFromMessageRef.current = false;
      return;
    }
    if (openedFromMessageRef.current && closesMenu(event)) {
      openedFromMessageRef.current = false;
      focusComposer();
    }
  };

  return (
    <div
      onMouseDownCapture={handleMouseDownCapture}
      onKeyDownCapture={handleKeyDownCapture}
    >
      <Dropdown
        triggerComponent={IconTrigger}
        icon={AtIcon}
        label="Add a field to the context"
        controlRef={dropdownRef}
        disabled={fieldPickerDisabledReason(scopedFields, unscopedFields)}
      >
        {/* The search field always shows, also with 5 fields or fewer: the
            letters typed after "@" filter the fields on every model */}
        <Dropdown.Menu
          placement="top-start"
          optionPaddingY={6}
          contextualSearch={{ placeholder: 'Search fields...' }}
        >
          {unscopedFields.map((field) => (
            <Dropdown.Option
              key={field.id}
              keywords={[field.apiKey]}
              onPick={() => onAddScope(field.id)}
            >
              <EntityRow layout="row" title={field.label}>
                {field.fieldType}
              </EntityRow>
            </Dropdown.Option>
          ))}
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
}

/**
 * The message of the next turn: what goes in the context, the text, and the
 * bar with auto-approve, the field picker and Send. Enter sends, and
 * Shift+Enter adds a line.
 */
export function Composer({
  text,
  onChange,
  onKeyDown,
  onSend,
  isSending,
  hasPendingApproval,
  scopedFields,
  unscopedFields,
  onAddScope,
  onRemoveScope,
  fieldPickerRef,
  supportsWriteApprovals,
  autoApproveEdits,
  onAutoApproveClick,
}: Props) {
  const disabledReason = isSending
    ? undefined
    : sendDisabledReason(text, hasPendingApproval);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // A disabled Send keeps the focus (aria-disabled): the form ignores any
    // submit that Send could not make
    if (isSending || disabledReason) return;
    void onSend();
  };

  return (
    <form className={s.composer} onSubmit={handleSubmit}>
      <div className={s.body}>
        <ContextRow scopedFields={scopedFields} onRemoveScope={onRemoveScope} />
        <FieldWrapper
          id={COMPOSER_INPUT_ID}
          label="Message"
          labelExtras={{ hidden: true }}
          hint={hasPendingApproval ? PENDING_APPROVAL : undefined}
        >
          <TextareaInput
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            rows={2}
            maxRows={7}
            placeholder="Summarize the body in five bullets"
            disabled={hasPendingApproval}
          />
        </FieldWrapper>
      </div>
      <Toolbar style="short">
        {supportsWriteApprovals && (
          // A button with a label takes no text tooltip of its own (its
          // `tooltip` is only for the name and keys of an action): it goes in
          // a Tooltip, as the Tooltip page shows. It is never disabled.
          <Tooltip
            label={
              autoApproveEdits ? AUTO_APPROVE_ON_HINT : AUTO_APPROVE_OFF_HINT
            }
          >
            <Toolbar.Button
              icon={BoltIcon}
              label="Auto-approve"
              pressed={autoApproveEdits}
              trailing={autoApproveEdits && <Pill tone="warning">On</Pill>}
              onClick={onAutoApproveClick}
            />
          </Tooltip>
        )}
        <FieldPicker
          scopedFields={scopedFields}
          unscopedFields={unscopedFields}
          onAddScope={onAddScope}
          fieldPickerRef={fieldPickerRef}
        />
        <Toolbar.Space />
        {/* The main action of the composer: primary, with its label (an
            icon-only button is ghost) */}
        <Toolbar.Button
          submit
          tone="primary"
          icon={SendIcon}
          label="Send"
          busy={isSending}
          disabled={disabledReason}
        />
      </Toolbar>
    </form>
  );
}
