import { SLASH_COMMANDS, type SlashCommandType } from '@ctypes/slashCommands';
import { useAfterPointerRelease } from '@hooks/useAfterPointerRelease';
import type { ModelInfo } from '@hooks/useMentions';
import { getRecordMentionModels } from '@utils/permissions';
import ApiKey from 'datocms-react-ui/ApiKey';
import Button from 'datocms-react-ui/Button';
import { Dropdown, useMenuSearchTerm } from 'datocms-react-ui/Dropdown';
import {
  EditorToolbar,
  useEditorToolbarWiring,
} from 'datocms-react-ui/EditorToolbar';
import EntityRow from 'datocms-react-ui/EntityRow';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import {
  type ComponentType,
  type RefObject,
  type SVGProps,
  useCallback,
  useEffect,
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
import RecordModelSelectorDropdown, {
  filterRecordModels,
  getRecordModelsEmptyMessage,
} from '../RecordModelSelectorDropdown';
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
   * The mention buttons. A button shows only when it has a handler and the
   * user can mention that kind (canMentionFields, canMentionAssets,
   * canMentionModels): a mention that does not apply is hidden, as in the
   * slash menu.
   */
  onUserClick: () => void;
  onFieldClick?: () => void;
  onAssetClick?: () => void;
  onModelClick?: () => void;
  /**
   * The models the user can read. The record mention lists the ones that are
   * not blocks, and shows only when there is one: in the toolbar it is a
   * menu of these models.
   */
  readableModels: ModelInfo[];
  /**
   * The model of the record to mention was picked, in the menu of the
   * toolbar or in the panel of /record
   */
  onRecordModelSelect: (model: ModelInfo) => void;
  /**
   * The model panel of /record, which asks for the model where the caret is:
   * the command has no trigger for a menu
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

function labelOf(command: SlashCommandType): string {
  return SLASH_COMMANDS.find((entry) => entry.name === command)?.label ?? '';
}

type MentionButton = {
  command: Exclude<SlashCommandType, 'record'>;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  onClick: (() => void) | undefined;
};

type RecordModelPick = (model: ModelInfo) => void;

/**
 * An option of the record mention menu. Its pick handler keeps its identity
 * across renders: a new handler of an option updates the menu, and every
 * update of the menu renders these options again (they read its search), so
 * a new handler at each render would never settle.
 */
function RecordModelOption({
  model,
  onPick,
}: {
  model: ModelInfo;
  onPick: RecordModelPick;
}) {
  const handlePick = useCallback(() => onPick(model), [onPick, model]);
  const keywords = useMemo(() => [model.apiKey], [model.apiKey]);

  return (
    <Dropdown.Option keywords={keywords} onPick={handlePick}>
      <EntityRow
        layout="row"
        title={model.name}
        afterTitle={<ApiKey>{model.apiKey}</ApiKey>}
      />
    </Dropdown.Option>
  );
}

/**
 * The options of the record mention menu: the models of the records, found
 * by their name or their API key (the menu gives the search)
 */
function RecordModelMenuOptions({
  models,
  onPick,
}: {
  models: ModelInfo[];
  onPick: RecordModelPick;
}) {
  const query = useMenuSearchTerm();
  const matches = useMemo(
    () => filterRecordModels(models, query),
    [models, query],
  );

  if (matches.length === 0) {
    return (
      <Dropdown.MenuEmpty>
        {getRecordModelsEmptyMessage(query, models.length)}
      </Dropdown.MenuEmpty>
    );
  }

  return (
    <Dropdown.Group name="Pick a model">
      {matches.map((model) => (
        <RecordModelOption key={model.id} model={model} onPick={onPick} />
      ))}
    </Dropdown.Group>
  );
}

/**
 * The editor of a comment, a reply or an edit: the mention buttons on top,
 * the text, and the buttons that send or save it. The plugin draws only the
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

  // The mention buttons show while the editor has the focus, and while the
  // record mention menu, the model panel of /record or a picker of the CMS
  // holds it
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

  // The search of the record mention menu, or of the panel of /record, takes
  // the focus while the user picks a model: the first step of a picker, not
  // the user leaving the text (an empty reply would go away on blur). Read at
  // the blur, thus kept in refs.
  const recordMenuOpenRef = useRef(false);
  const recordPanelOpenRef = useRef(isRecordModelSelectorOpen);
  recordPanelOpenRef.current = isRecordModelSelectorOpen;

  const handleRecordMenuToggle = useCallback(
    (open: boolean) => {
      const wasOpen = recordMenuOpenRef.current;
      recordMenuOpenRef.current = open;
      onMenuToggle(open);
      // The text gets the focus back from the search, as after the panel of
      // /record; a pick goes on in the record picker of the CMS
      if (wasOpen && !open) focusEditor();
    },
    [onMenuToggle, focusEditor],
  );

  // A record mention that stops applying while its menu is open (no model
  // left) takes the menu away without a toggle
  const hasRecordMention = recordModels.length > 0;
  useEffect(() => {
    if (hasRecordMention || !recordMenuOpenRef.current) return;
    recordMenuOpenRef.current = false;
    onMenuToggle(false);
  }, [hasRecordMention, onMenuToggle]);

  const handleBlur = useCallback(() => {
    editorFocusedRef.current = false;
    if (!recordMenuOpenRef.current && !recordPanelOpenRef.current) {
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

  const mentionButtons: MentionButton[] = [
    { command: 'user', Icon: UserMentionIcon, onClick: onUserClick },
    {
      command: 'field',
      Icon: FieldMentionIcon,
      onClick: canMentionFields ? onFieldClick : undefined,
    },
    {
      command: 'asset',
      Icon: AssetMentionIcon,
      onClick: canMentionAssets ? onAssetClick : undefined,
    },
    {
      command: 'model',
      Icon: ModelMentionIcon,
      onClick: canMentionModels ? onModelClick : undefined,
    },
  ];

  return (
    <div className={cn(styles.frame, variant === 'new' && styles.frameNew)}>
      <div className={cn(styles.toolbar, !visible && styles.toolbarHidden)}>
        <EditorToolbar ariaLabel="Mentions" hidden={!visible}>
          <EditorToolbar.Group>
            {mentionButtons.map(({ command, Icon, onClick }) =>
              onClick ? (
                <EditorToolbar.Button
                  key={command}
                  active={false}
                  label={labelOf(command)}
                  onClick={onClick}
                >
                  <Icon />
                </EditorToolbar.Button>
              ) : null,
            )}
          </EditorToolbar.Group>
          {/* A record mention starts with the model of the record: a menu
              of the models. Without a model to pick, it does not apply. */}
          {hasRecordMention && (
            <EditorToolbar.Group>
              <EditorToolbar.Dropdown
                icon={RecordMentionIcon}
                label="Record"
                onToggle={handleRecordMenuToggle}
              >
                <Dropdown.Menu
                  contextualSearch={{ placeholder: 'Search models…' }}
                >
                  <RecordModelMenuOptions
                    models={recordModels}
                    onPick={onRecordModelSelect}
                  />
                </Dropdown.Menu>
              </EditorToolbar.Dropdown>
            </EditorToolbar.Group>
          )}
        </EditorToolbar>
      </div>

      {/* Positioned: the model panel of /record opens where the mention
          panels do, at the text */}
      <div className={styles.editorArea}>
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
