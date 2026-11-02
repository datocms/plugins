import type { SlashCommandType } from '@ctypes/slashCommands';
import { useAfterPointerRelease } from '@hooks/useAfterPointerRelease';
import type { ModelInfo } from '@hooks/useMentions';
import { getRecordMentionModels } from '@utils/permissions';
import Button from 'datocms-react-ui/Button';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import {
  EditorToolbar,
  useEditorToolbarWiring,
} from 'datocms-react-ui/EditorToolbar';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import {
  type ComponentType,
  type RefObject,
  type SVGProps,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { cn } from '@/utils/cn';
import {
  AssetMentionIcon,
  FieldMentionIcon,
  ModelMentionIcon,
  RecordMentionIcon,
  SendIcon,
  UserMentionIcon,
} from '../Icons';
import RecordModelSelectorDropdown from '../RecordModelSelectorDropdown';
import {
  TipTapComposer,
  type TipTapComposerProps,
  type TipTapComposerRef,
} from '../tiptap/TipTapComposer';
import styles from './CommentComposer.module.css';

/** new: a comment of the record. edit: a change of a comment. reply: a new reply. */
export type CommentComposerVariant = 'new' | 'edit' | 'reply';

type CommentComposerProps = Omit<
  TipTapComposerProps,
  'placeholder' | 'ariaLabel' | 'onFocus'
> & {
  variant: CommentComposerVariant;
  composerRef: RefObject<TipTapComposerRef | null>;
  /**
   * The options of the Mention menu. An option shows only when it has a
   * handler and the user can mention that kind (canMentionFields,
   * canMentionAssets, canMentionModels): a mention that does not apply is
   * hidden, as in the slash menu.
   */
  onUserClick: () => void;
  onFieldClick?: () => void;
  onAssetClick?: () => void;
  onModelClick?: () => void;
  /**
   * The models the user can read. The record mention lists the ones that are
   * not blocks, and shows only when there is one.
   */
  readableModels: ModelInfo[];
  /** The model of the record to mention was picked, in the panel of a record */
  onRecordModelSelect: (model: ModelInfo) => void;
  /**
   * The model panel of a record mention (from /record or from the Mention
   * menu), which asks for the model where the caret is
   */
  isRecordModelSelectorOpen: boolean;
  onRecordModelSelectorClose: () => void;
  /** A picker of the CMS (assets, records) is open for this composer */
  busy?: boolean;
  /** Why the content cannot be sent or saved yet; null when it can */
  submitDisabledReason: string | null;
};

const TEXTS: Record<
  CommentComposerVariant,
  { ariaLabel: string; placeholder: string; submit: string }
> = {
  new: { ariaLabel: 'Comment', placeholder: 'Add a comment…', submit: 'Send' },
  edit: { ariaLabel: 'Edit comment', placeholder: '', submit: 'Save' },
  reply: { ariaLabel: 'Reply', placeholder: 'Add a reply…', submit: 'Reply' },
};

type MentionOption = {
  command: SlashCommandType;
  /** The kind of mention, as the menu names it */
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  onPick: (() => void) | undefined;
};

/**
 * The editor of a comment, a reply or an edit: the Mention menu on top, the
 * text, and the buttons that send or save it. The plugin draws only the
 * frame of this composite input; the mention panels open inside it.
 */
export function CommentComposer({
  variant,
  composerRef,
  onUserClick,
  onFieldClick,
  onAssetClick,
  onModelClick,
  readableModels,
  onRecordModelSelect,
  isRecordModelSelectorOpen,
  onRecordModelSelectorClose,
  busy = false,
  submitDisabledReason,
  onSubmit,
  onCancel,
  onBlur,
  dropdownPosition = 'below',
  ...editorProps
}: CommentComposerProps) {
  const texts = TEXTS[variant];

  const focusEditor = useCallback(() => {
    composerRef.current?.focus();
  }, [composerRef]);

  // The Mention menu shows while the editor has the focus, and while its
  // menu, the model panel of a record or a picker of the CMS holds it
  const { setFocused, onMenuToggle, visible } = useEditorToolbarWiring({
    busy: isRecordModelSelectorOpen || busy,
    focusEditor,
  });

  const recordModels = useMemo(
    () => getRecordMentionModels(readableModels),
    [readableModels],
  );

  // The toolbar takes no room while it hides, as in the editors of the CMS.
  // After a blur it hides only once the press that caused it ends: the
  // content under the pointer stays in place until the click lands.
  const editorFocusedRef = useRef(false);
  const afterPointerRelease = useAfterPointerRelease();

  const handleFocus = useCallback(() => {
    editorFocusedRef.current = true;
    setFocused(true);
  }, [setFocused]);

  // The Mention menu, or the search of the model panel of a record, has the
  // focus while the user picks: not the user leaving the text (an empty reply
  // would go away on blur). Read at the blur, thus kept in refs.
  const mentionMenuOpenRef = useRef(false);
  const recordPanelOpenRef = useRef(isRecordModelSelectorOpen);
  recordPanelOpenRef.current = isRecordModelSelectorOpen;

  // The text and the mention panels that open at its caret
  const editorAreaRef = useRef<HTMLDivElement>(null);

  const handleMentionMenuToggle = useCallback(
    (open: boolean) => {
      const wasOpen = mentionMenuOpenRef.current;
      mentionMenuOpenRef.current = open;
      onMenuToggle(open);
      // The text gets the focus back, unless the pick opened a mention panel
      // whose search field took it
      if (
        wasOpen &&
        !open &&
        !editorAreaRef.current?.contains(document.activeElement)
      ) {
        focusEditor();
      }
    },
    [onMenuToggle, focusEditor],
  );

  // A record mention applies only with a model whose records the user can
  // read
  const hasRecordMention = recordModels.length > 0;

  const handleBlur = useCallback(() => {
    editorFocusedRef.current = false;
    if (!mentionMenuOpenRef.current && !recordPanelOpenRef.current) {
      onBlur?.();
    }
    afterPointerRelease(() => {
      if (!editorFocusedRef.current) setFocused(false);
    });
  }, [setFocused, onBlur, afterPointerRelease]);

  const {
    canMentionFields = true,
    canMentionAssets = true,
    canMentionModels = true,
  } = editorProps;

  // The same kinds, in the same order, as the slash menu
  const mentionOptions: MentionOption[] = [
    {
      command: 'user',
      label: 'Collaborator',
      Icon: UserMentionIcon,
      onPick: onUserClick,
    },
    {
      command: 'field',
      label: 'Field',
      Icon: FieldMentionIcon,
      onPick: canMentionFields ? onFieldClick : undefined,
    },
    {
      command: 'record',
      label: 'Record',
      Icon: RecordMentionIcon,
      onPick: hasRecordMention ? editorProps.onRecordTrigger : undefined,
    },
    {
      command: 'asset',
      label: 'Asset',
      Icon: AssetMentionIcon,
      onPick: canMentionAssets ? onAssetClick : undefined,
    },
    {
      command: 'model',
      label: 'Model',
      Icon: ModelMentionIcon,
      onPick: canMentionModels ? onModelClick : undefined,
    },
  ];

  return (
    <div className={cn(styles.frame, variant === 'new' && styles.frameNew)}>
      <div className={cn(styles.toolbar, !visible && styles.toolbarHidden)}>
        <EditorToolbar ariaLabel="Mentions" hidden={!visible}>
          <EditorToolbar.Group>
            {/* One labeled menu, with the words of the slash menu */}
            <EditorToolbar.Dropdown
              label="Mention"
              onToggle={handleMentionMenuToggle}
            >
              <Dropdown.Menu contextualSearch={false}>
                {mentionOptions.map(({ command, label, Icon, onPick }) =>
                  onPick ? (
                    <Dropdown.Option
                      key={command}
                      icon={<Icon />}
                      onPick={onPick}
                    >
                      {label}
                    </Dropdown.Option>
                  ) : null,
                )}
              </Dropdown.Menu>
            </EditorToolbar.Dropdown>
          </EditorToolbar.Group>
        </EditorToolbar>
      </div>

      {/* Positioned: the model panel of a record opens where the mention
          panels do, at the text */}
      <div ref={editorAreaRef} className={styles.editorArea}>
        {/* The editor is an input of the plugin: the field gives it its
            name (the hidden label), as to every input of the kit */}
        <FieldWrapper
          label={texts.ariaLabel}
          labelExtras={{ hidden: true }}
          container={{ className: styles.field }}
        >
          <TipTapComposer
            ref={composerRef}
            {...editorProps}
            placeholder={texts.placeholder}
            ariaLabel={texts.ariaLabel}
            onSubmit={onSubmit}
            onCancel={onCancel}
            onFocus={handleFocus}
            onBlur={handleBlur}
            dropdownPosition={dropdownPosition}
          />
        </FieldWrapper>
        {isRecordModelSelectorOpen && (
          <RecordModelSelectorDropdown
            models={readableModels}
            onSelect={onRecordModelSelect}
            onClose={onRecordModelSelectorClose}
            position={dropdownPosition}
          />
        )}
      </div>

      <div className={styles.footer}>
        {variant !== 'new' && (
          <Button
            tone="ghost"
            label="Cancel"
            onClick={() => {
              onCancel?.();
            }}
          />
        )}
        <Button
          tone="primary"
          icon={variant === 'new' ? SendIcon : undefined}
          label={texts.submit}
          onClick={() => {
            onSubmit?.();
          }}
          disabled={
            submitDisabledReason ? { reason: submitDisabledReason } : false
          }
        />
      </div>
    </div>
  );
}
