import {
  forwardRef,
  useImperativeHandle,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import type { Editor } from '@tiptap/core';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';

import { createMentionNodeExtension } from './extensions/createMentionExtension';
import { createSlashSuggestionExtension } from './extensions/createSlashSuggestionExtension';
import {
  UserMentionNodeView,
  FieldMentionNodeView,
  AssetMentionNodeView,
  RecordMentionNodeView,
  ModelMentionNodeView,
} from './MentionNodeView';
import { MentionClickContext } from './MentionClickContext';
import {
  segmentsToTipTapDoc,
  tipTapDocToFullSegments,
  MENTION_NODE_TYPES,
} from '@utils/tipTapSerializer';
import { filterUsers, filterFields, filterModels } from '@utils/mentions';
import { areSegmentsEqual } from '@utils/comparisonHelpers';

import type { CommentSegment, Mention, UserMention, FieldMention, ModelMention, AssetMention, RecordMention } from '@ctypes/mentions';
import type { UserInfo, FieldInfo, ModelInfo } from '@hooks/useMentions';
import { useNavigationContext } from '@/entrypoints/contexts/NavigationCallbacksContext';

import UserMentionDropdown from '../UserMentionDropdown';
import FieldMentionDropdown from '../FieldMentionDropdown';
import ModelMentionDropdown from '../ModelMentionDropdown';
import { SlashCommandMenu } from '../slash-command';

import type { ActiveSlashCommand, SlashCommandDefinition } from '@ctypes/slashCommands';
import { SLASH_COMMANDS } from '@ctypes/slashCommands';
import { parseSlashQuery, filterSlashCommands } from '@utils/slashCommandParser';

import { cn } from '@/utils/cn';
import styles from './TipTapComposer.module.css';

type TipTapComposerProps = {
  segments: CommentSegment[];
  onSegmentsChange?: (segments: CommentSegment[]) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  projectUsers: UserInfo[];
  modelFields?: FieldInfo[];
  projectModels: ModelInfo[];
  canMentionAssets?: boolean;
  canMentionModels?: boolean;
  canMentionFields?: boolean;
  onAssetTrigger?: () => void;
  onRecordTrigger?: () => void;
  autoFocus?: boolean;
  large?: boolean;
  dropdownPosition?: 'above' | 'below';
  ctx?: RenderItemFormSidebarCtx;
};

export type TipTapComposerRef = {
  focus: () => void;
  clear: () => void;
  insertMention: (mention: Mention) => void;
  insertText: (text: string) => void;
  getSegments: () => CommentSegment[];
  isEmpty: () => boolean;
  getEditor: () => Editor | null;
  /** Directly triggers mention type selection (user/field/model), bypassing the command menu */
  triggerMentionType: (type: 'user' | 'field' | 'model') => void;
};

export const TipTapComposer = forwardRef<TipTapComposerRef, TipTapComposerProps>(
  (
    {
      segments,
      onSegmentsChange,
      onSubmit,
      onCancel,
      onBlur,
      placeholder = 'Write a comment...',
      projectUsers,
      modelFields = [],
      projectModels,
      canMentionAssets = true,
      canMentionModels = true,
      canMentionFields = true,
      onAssetTrigger,
      onRecordTrigger,
      autoFocus = false,
      large = false,
      dropdownPosition = 'below',
      ctx,
    },
    ref
  ) => {
    const nav = useNavigationContext();

    // Slash command state
    const [activeSlashCommand, setActiveSlashCommand] = useState<ActiveSlashCommand | null>(null);
    const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
    const [selectedItemIndex, setSelectedItemIndex] = useState(0);
    const activeSlashCommandRef = useRef<ActiveSlashCommand | null>(null);

    const fieldKeyHandlerRef = useRef<((key: string) => boolean) | null>(null);
    const [pendingFieldForLocale, setPendingFieldForLocale] = useState<FieldInfo | null>(null);

    useEffect(() => {
      activeSlashCommandRef.current = activeSlashCommand;
    }, [activeSlashCommand]);

    const onSubmitRef = useRef(onSubmit);
    const onCancelRef = useRef(onCancel);
    const onBlurRef = useRef(onBlur);
    const onAssetTriggerRef = useRef(onAssetTrigger);
    const onRecordTriggerRef = useRef(onRecordTrigger);
    const onSegmentsChangeRef = useRef(onSegmentsChange);

    const isMountedRef = useRef(true);

    useEffect(() => {
      return () => {
        isMountedRef.current = false;
        activeSlashCommandRef.current = null;
        editorRef.current = null;
        fieldKeyHandlerRef.current = null;
      };
    }, []);

    useEffect(() => {
      onSubmitRef.current = onSubmit;
      onCancelRef.current = onCancel;
      onBlurRef.current = onBlur;
      onAssetTriggerRef.current = onAssetTrigger;
      onRecordTriggerRef.current = onRecordTrigger;
      onSegmentsChangeRef.current = onSegmentsChange;
    }, [onSubmit, onCancel, onBlur, onAssetTrigger, onRecordTrigger, onSegmentsChange]);

    const projectUsersRef = useRef(projectUsers);
    const modelFieldsRef = useRef(modelFields);
    const projectModelsRef = useRef(projectModels);

    useEffect(() => {
      projectUsersRef.current = projectUsers;
      modelFieldsRef.current = modelFields;
      projectModelsRef.current = projectModels;
    }, [projectUsers, modelFields, projectModels]);

    // Get available commands based on permissions
    const availableCommands = useMemo(() => {
      return SLASH_COMMANDS.filter((cmd) => {
        if (cmd.name === 'asset' && !canMentionAssets) return false;
        if (cmd.name === 'model' && !canMentionModels) return false;
        if (cmd.name === 'field' && (!canMentionFields || modelFields.length === 0)) return false;
        return true;
      });
    }, [canMentionAssets, canMentionModels, canMentionFields, modelFields]);

    const isCommandAvailable = useCallback(
      (name: SlashCommandDefinition['name']) =>
        availableCommands.some((cmd) => cmd.name === name),
      [availableCommands]
    );

    const getAvailableMatchingCommands = useCallback(
      (query: string) =>
        filterSlashCommands(query).filter((cmd) => isCommandAvailable(cmd.name)),
      [isCommandAvailable]
    );

    // Filtered slash commands for command_selection phase
    const filteredCommands = useMemo(() => {
      if (!activeSlashCommand || activeSlashCommand.phase !== 'command_selection') {
        return availableCommands;
      }
      return getAvailableMatchingCommands(activeSlashCommand.commandPart);
    }, [activeSlashCommand, availableCommands, getAvailableMatchingCommands]);

    // Filtered items for type_selection phase
    const filteredUsers = useMemo(() => {
      if (activeSlashCommand?.phase !== 'type_selection' || activeSlashCommand.selectedType !== 'user') {
        return [];
      }
      return filterUsers(projectUsers, activeSlashCommand.searchQuery);
    }, [projectUsers, activeSlashCommand]);

    const filteredFields = useMemo(() => {
      if (activeSlashCommand?.phase !== 'type_selection' || activeSlashCommand.selectedType !== 'field') {
        return [];
      }
      return filterFields(modelFields, activeSlashCommand.searchQuery);
    }, [modelFields, activeSlashCommand]);

    const filteredModels = useMemo(() => {
      if (activeSlashCommand?.phase !== 'type_selection' || activeSlashCommand.selectedType !== 'model') {
        return [];
      }
      return filterModels(projectModels, activeSlashCommand.searchQuery);
    }, [projectModels, activeSlashCommand]);

    const selectedCommandIndexRef = useRef(0);
    useEffect(() => {
      selectedCommandIndexRef.current = selectedCommandIndex;
    }, [selectedCommandIndex]);

    const selectedItemIndexRef = useRef(0);
    useEffect(() => {
      selectedItemIndexRef.current = selectedItemIndex;
    }, [selectedItemIndex]);

    const editorRef = useRef<Editor | null>(null);

    const registerFieldKeyHandler = useCallback((handler: (key: string) => boolean) => {
      fieldKeyHandlerRef.current = handler;
    }, []);

    const clearPendingFieldForLocale = useCallback(() => {
      setPendingFieldForLocale(null);
    }, []);

    const handleMentionClick = useCallback((mention: Mention) => {
      switch (mention.type) {
        case 'user':
          nav.handleNavigateToUsers();
          break;
        case 'field': {
          const fieldMention = mention as FieldMention;
          nav.handleScrollToField?.(fieldMention.fieldPath, fieldMention.localized, fieldMention.locale);
          break;
        }
        case 'asset': {
          const assetMention = mention as AssetMention;
          nav.handleOpenAsset(assetMention.id);
          break;
        }
        case 'record': {
          const recordMention = mention as RecordMention;
          nav.handleOpenRecord(recordMention.id, recordMention.modelId);
          break;
        }
        case 'model': {
          const modelMention = mention as ModelMention;
          nav.handleNavigateToModel(modelMention.id, modelMention.isBlockModel);
          break;
        }
      }
    }, [nav]);

    const mentionClickContextValue = useMemo(
      () => ({ onMentionClick: handleMentionClick }),
      [handleMentionClick]
    );

    // Handle command selection in the slash command menu
    const handleSelectCommand = useCallback(
      (command: SlashCommandDefinition) => {
        if (!isCommandAvailable(command.name)) return;

        const currentEditor = editorRef.current;
        const currentCommand = activeSlashCommandRef.current;

        if (!currentEditor || !currentCommand) return;

        // For record and asset, delete the slash command text and trigger the picker
        if (command.name === 'record' || command.name === 'asset') {
          currentEditor.chain().focus().deleteRange(currentCommand.range).run();
          setActiveSlashCommand(null);

          if (command.name === 'record') {
            onRecordTriggerRef.current?.();
          } else {
            onAssetTriggerRef.current?.();
          }
          return;
        }

        // For user, field, model - update editor text and transition to type_selection phase
        const newCommandText = `/${command.name} `;
        const rangeStart = currentCommand.range.from;

        // Replace current text (e.g., "/u") with complete command (e.g., "/user ")
        currentEditor
          .chain()
          .focus()
          .deleteRange(currentCommand.range)
          .insertContentAt(rangeStart, newCommandText)
          .run();

        // Calculate new range that covers the inserted command text
        const newRange = {
          from: rangeStart,
          to: rangeStart + newCommandText.length,
        };

        setActiveSlashCommand({
          ...currentCommand,
          phase: 'type_selection',
          selectedType: command.name,
          searchQuery: '',
          commandPart: command.name,
          rawQuery: `${command.name} `,
          range: newRange,
        });
        setSelectedItemIndex(0);
      },
      [isCommandAvailable]
    );

    // Create slash suggestion handler
    const createSlashSuggestionHandler = useCallback(
      () => ({
        char: '/',
        allowSpaces: true,

        items: () => [],

        render: () => ({
          onStart: (props: SuggestionProps) => {
            const parsed = parseSlashQuery(props.query);

            // If starting with a complete command (e.g., from toolbar inserting "/user "),
            // skip directly to type_selection phase
            if (parsed.isComplete && parsed.exactMatch) {
              if (!isCommandAvailable(parsed.exactMatch.name)) {
                setActiveSlashCommand({
                  phase: 'command_selection',
                  rawQuery: props.query,
                  commandPart: parsed.commandPart,
                  searchQuery: parsed.searchQuery,
                  selectedType: null,
                  range: props.range,
                  clientRect: props.clientRect ?? null,
                });
                setSelectedCommandIndex(0);
                return;
              }

              // Special handling for record/asset - trigger picker immediately
              if (parsed.exactMatch.name === 'record' || parsed.exactMatch.name === 'asset') {
                const currentEditor = editorRef.current;
                if (currentEditor) {
                  currentEditor.chain().focus().deleteRange(props.range).run();
                }
                if (parsed.exactMatch.name === 'record') {
                  onRecordTriggerRef.current?.();
                } else {
                  onAssetTriggerRef.current?.();
                }
                return;
              }

              setActiveSlashCommand({
                phase: 'type_selection',
                rawQuery: props.query,
                commandPart: parsed.commandPart,
                searchQuery: parsed.searchQuery,
                selectedType: parsed.exactMatch.name,
                range: props.range,
                clientRect: props.clientRect ?? null,
              });
              setSelectedItemIndex(0);
              return;
            }

            setActiveSlashCommand({
              phase: 'command_selection',
              rawQuery: props.query,
              commandPart: parsed.commandPart,
              searchQuery: parsed.searchQuery,
              selectedType: null,
              range: props.range,
              clientRect: props.clientRect ?? null,
            });
            setSelectedCommandIndex(0);
            setSelectedItemIndex(0);
          },

          onUpdate: (props: SuggestionProps) => {
            const parsed = parseSlashQuery(props.query);
            const currentCommand = activeSlashCommandRef.current;

            // Auto-transition to type_selection if command is complete
            if (parsed.isComplete && parsed.exactMatch && currentCommand?.phase === 'command_selection') {
              if (!isCommandAvailable(parsed.exactMatch.name)) {
                setActiveSlashCommand((prev) =>
                  prev
                    ? {
                        ...prev,
                        rawQuery: props.query,
                        commandPart: parsed.commandPart,
                        searchQuery: parsed.searchQuery,
                        selectedType: null,
                        range: props.range,
                        clientRect: props.clientRect ?? null,
                      }
                    : null
                );
                setSelectedCommandIndex(0);
                return;
              }

              // Special handling for record/asset - trigger picker immediately
              if (parsed.exactMatch.name === 'record' || parsed.exactMatch.name === 'asset') {
                const currentEditor = editorRef.current;
                if (currentEditor) {
                  currentEditor.chain().focus().deleteRange(props.range).run();
                }
                setActiveSlashCommand(null);

                if (parsed.exactMatch.name === 'record') {
                  onRecordTriggerRef.current?.();
                } else {
                  onAssetTriggerRef.current?.();
                }
                return;
              }

              setActiveSlashCommand({
                phase: 'type_selection',
                rawQuery: props.query,
                commandPart: parsed.commandPart,
                searchQuery: parsed.searchQuery,
                selectedType: parsed.exactMatch.name,
                range: props.range,
                clientRect: props.clientRect ?? null,
              });
              setSelectedItemIndex(0);
              return;
            }

            // Update state without phase transition
            setActiveSlashCommand((prev) =>
              prev
                ? {
                    ...prev,
                    rawQuery: props.query,
                    commandPart: parsed.commandPart,
                    searchQuery: parsed.searchQuery,
                    range: props.range,
                    clientRect: props.clientRect ?? null,
                  }
                : null
            );

            // Reset selection index when query changes
            if (currentCommand?.phase === 'command_selection') {
              setSelectedCommandIndex(0);
            } else {
              setSelectedItemIndex(0);
            }
          },

          onExit: () => {
            setActiveSlashCommand(null);
            setSelectedCommandIndex(0);
            setSelectedItemIndex(0);
            setPendingFieldForLocale(null);
            fieldKeyHandlerRef.current = null;
          },

          onKeyDown: (props: SuggestionKeyDownProps) => {
            const { event, range } = props;
            const currentCommand = activeSlashCommandRef.current;

            if (!currentCommand) return false;

            // Phase 1: Command selection
            if (currentCommand.phase === 'command_selection') {
              const commands = getAvailableMatchingCommands(currentCommand.commandPart);

              if (event.key === 'ArrowDown') {
                if (commands.length > 0) {
                  setSelectedCommandIndex((prev) => (prev + 1) % commands.length);
                }
                return true;
              }

              if (event.key === 'ArrowUp') {
                if (commands.length > 0) {
                  setSelectedCommandIndex((prev) => (prev - 1 + commands.length) % commands.length);
                }
                return true;
              }

              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                const idx = selectedCommandIndexRef.current;
                const selectedCommand = commands[idx];
                if (selectedCommand) {
                  handleSelectCommand(selectedCommand);
                }
                return true;
              }

              if (event.key === 'Escape') {
                setActiveSlashCommand(null);
                return true;
              }

              return false;
            }

            // Phase 2: Type selection
            if (currentCommand.phase === 'type_selection') {
              // Handle field dropdown key navigation
              if (currentCommand.selectedType === 'field' && fieldKeyHandlerRef.current) {
                const handled = fieldKeyHandlerRef.current(event.key);
                if (handled) {
                  event.preventDefault();
                  return true;
                }
              }

              // Get the appropriate list for the selected type
              let currentList: UserInfo[] | FieldInfo[] | ModelInfo[] = [];
              if (currentCommand.selectedType === 'user') {
                currentList = filterUsers(projectUsersRef.current, currentCommand.searchQuery);
              } else if (currentCommand.selectedType === 'field') {
                currentList = filterFields(modelFieldsRef.current, currentCommand.searchQuery);
              } else if (currentCommand.selectedType === 'model') {
                currentList = filterModels(projectModelsRef.current, currentCommand.searchQuery);
              }

              if (event.key === 'ArrowDown') {
                if (currentList.length > 0) {
                  setSelectedItemIndex((prev) => (prev + 1) % currentList.length);
                }
                return true;
              }

              if (event.key === 'ArrowUp') {
                if (currentList.length > 0) {
                  setSelectedItemIndex((prev) => (prev - 1 + currentList.length) % currentList.length);
                }
                return true;
              }

              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                const idx = selectedItemIndexRef.current;
                const selectedItem = currentList[idx];
                const currentEditor = editorRef.current;

                if (selectedItem && currentEditor) {
                  if (currentCommand.selectedType === 'user') {
                    const user = selectedItem as UserInfo;
                    currentEditor
                      .chain()
                      .focus()
                      .deleteRange(range)
                      .insertContent([
                        {
                          type: MENTION_NODE_TYPES.user,
                          attrs: {
                            type: 'user',
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            avatarUrl: user.avatarUrl,
                          },
                        },
                        { type: 'text', text: ' ' },
                      ])
                      .run();
                    setActiveSlashCommand(null);
                  } else if (currentCommand.selectedType === 'model') {
                    const model = selectedItem as ModelInfo;
                    currentEditor
                      .chain()
                      .focus()
                      .deleteRange(range)
                      .insertContent([
                        {
                          type: MENTION_NODE_TYPES.model,
                          attrs: {
                            type: 'model',
                            id: model.id,
                            apiKey: model.apiKey,
                            name: model.name,
                            isBlockModel: model.isBlockModel,
                          },
                        },
                        { type: 'text', text: ' ' },
                      ])
                      .run();
                    setActiveSlashCommand(null);
                  } else if (currentCommand.selectedType === 'field') {
                    const field = selectedItem as FieldInfo;
                    const needsDrillDown =
                      field.isBlockContainer ||
                      (field.localized && field.availableLocales && field.availableLocales.length > 1);

                    if (needsDrillDown) {
                      setPendingFieldForLocale(field);
                      setSelectedItemIndex(0);
                    } else {
                      currentEditor
                        .chain()
                        .focus()
                        .deleteRange(range)
                        .insertContent([
                          {
                            type: MENTION_NODE_TYPES.field,
                            attrs: {
                              type: 'field',
                              apiKey: field.apiKey,
                              label: field.label,
                              localized: field.localized,
                              fieldPath: field.fieldPath,
                              locale: field.availableLocales?.[0],
                              fieldType: field.fieldType,
                            },
                          },
                          { type: 'text', text: ' ' },
                        ])
                        .run();
                      setActiveSlashCommand(null);
                    }
                  }
                }
                return true;
              }

              // Backspace with empty search returns to command selection
              if (event.key === 'Backspace' && !currentCommand.searchQuery) {
                setActiveSlashCommand({
                  ...currentCommand,
                  phase: 'command_selection',
                  selectedType: null,
                });
                setSelectedCommandIndex(0);
                return true;
              }

              if (event.key === 'Escape') {
                setActiveSlashCommand(null);
                return true;
              }

              return false;
            }

            return false;
          },
        }),
      }),
      [handleSelectCommand, getAvailableMatchingCommands, isCommandAvailable]
    );

    // Create mention node extensions (without suggestion handlers)
    const mentionExtensions = useMemo(() => {
      const SlashSuggestion = createSlashSuggestionExtension();

      return [
        SlashSuggestion.configure({
          suggestion: createSlashSuggestionHandler(),
        }),
        createMentionNodeExtension({
          name: MENTION_NODE_TYPES.user,
          mentionType: 'user',
          nodeViewComponent: UserMentionNodeView,
        }),
        createMentionNodeExtension({
          name: MENTION_NODE_TYPES.field,
          mentionType: 'field',
          nodeViewComponent: FieldMentionNodeView,
        }),
        createMentionNodeExtension({
          name: MENTION_NODE_TYPES.model,
          mentionType: 'model',
          nodeViewComponent: ModelMentionNodeView,
        }),
        createMentionNodeExtension({
          name: MENTION_NODE_TYPES.asset,
          mentionType: 'asset',
          nodeViewComponent: AssetMentionNodeView,
        }),
        createMentionNodeExtension({
          name: MENTION_NODE_TYPES.record,
          mentionType: 'record',
          nodeViewComponent: RecordMentionNodeView,
        }),
      ];
    }, [createSlashSuggestionHandler]);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          blockquote: false,
          bulletList: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          listItem: false,
          orderedList: false,
          paragraph: {},
          hardBreak: {},
          bold: false,
          code: false,
          italic: false,
          strike: false,
        }),
        Placeholder.configure({
          placeholder,
        }),
        ...mentionExtensions,
      ],
      content: segmentsToTipTapDoc(segments),
      autofocus: autoFocus ? 'end' : false,
      editorProps: {
        handleKeyDown: (_view, event) => {
          // Submit on Enter (when not in slash command mode)
          if (event.key === 'Enter' && !event.shiftKey && !activeSlashCommandRef.current) {
            event.preventDefault();
            onSubmitRef.current?.();
            return true;
          }

          // Cancel on Escape (when not in slash command mode)
          if (event.key === 'Escape' && !activeSlashCommandRef.current) {
            event.preventDefault();
            onCancelRef.current?.();
            return true;
          }

          return false;
        },
      },
      onUpdate: ({ editor }) => {
        const doc = editor.getJSON();
        const newSegments = tipTapDocToFullSegments(doc);
        onSegmentsChangeRef.current?.(newSegments);
      },
      onBlur: () => {
        onBlurRef.current?.();
      },
    });

    useEffect(() => {
      editorRef.current = editor;
    }, [editor]);

    const handleSelectUser = useCallback(
      (user: UserInfo) => {
        const slashCommand = activeSlashCommandRef.current;
        if (!editor || !slashCommand || slashCommand.selectedType !== 'user') return;

        const mention: UserMention = {
          type: 'user',
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
        };

        editor
          .chain()
          .focus()
          .deleteRange(slashCommand.range)
          .insertContent([
            {
              type: MENTION_NODE_TYPES.user,
              attrs: mention,
            },
            { type: 'text', text: ' ' },
          ])
          .run();

        setActiveSlashCommand(null);
      },
      [editor]
    );

    const handleSelectField = useCallback(
      (field: FieldInfo, locale?: string) => {
        const slashCommand = activeSlashCommandRef.current;
        if (!editor || !slashCommand || slashCommand.selectedType !== 'field') return;

        const mention: FieldMention = {
          type: 'field',
          apiKey: field.apiKey,
          label: field.label,
          localized: field.localized,
          fieldPath: field.fieldPath,
          locale,
          fieldType: field.fieldType,
        };

        editor
          .chain()
          .focus()
          .deleteRange(slashCommand.range)
          .insertContent([
            {
              type: MENTION_NODE_TYPES.field,
              attrs: mention,
            },
            { type: 'text', text: ' ' },
          ])
          .run();

        setActiveSlashCommand(null);
      },
      [editor]
    );

    const handleSelectModel = useCallback(
      (model: ModelInfo) => {
        const slashCommand = activeSlashCommandRef.current;
        if (!editor || !slashCommand || slashCommand.selectedType !== 'model') return;

        const mention: ModelMention = {
          type: 'model',
          id: model.id,
          apiKey: model.apiKey,
          name: model.name,
          isBlockModel: model.isBlockModel,
        };

        editor
          .chain()
          .focus()
          .deleteRange(slashCommand.range)
          .insertContent([
            {
              type: MENTION_NODE_TYPES.model,
              attrs: mention,
            },
            { type: 'text', text: ' ' },
          ])
          .run();

        setActiveSlashCommand(null);
      },
      [editor]
    );

    const handleCloseDropdown = useCallback(() => {
      setActiveSlashCommand(null);
    }, []);

    // Update editor text when field navigation path changes
    const handleFieldPathChange = useCallback(
      (breadcrumb: string) => {
        const currentEditor = editorRef.current;
        const currentCommand = activeSlashCommandRef.current;

        if (!currentEditor || !currentCommand || currentCommand.selectedType !== 'field') return;

        // Build new text: "/field " or "/field Label > Locale > Block #1"
        const newText = breadcrumb ? `/field ${breadcrumb}` : '/field ';
        const rangeStart = currentCommand.range.from;

        // Replace current text with updated path
        currentEditor
          .chain()
          .focus()
          .deleteRange(currentCommand.range)
          .insertContentAt(rangeStart, newText)
          .run();

        // Update range to cover the new text
        const newRange = {
          from: rangeStart,
          to: rangeStart + newText.length,
        };

        setActiveSlashCommand((prev) =>
          prev
            ? {
                ...prev,
                range: newRange,
                rawQuery: breadcrumb ? `field ${breadcrumb}` : 'field ',
              }
            : null
        );
      },
      []
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          editor?.chain().focus().run();
        },

        clear: () => {
          editor?.chain().clearContent().run();
        },

        insertMention: (mention: Mention) => {
          if (!editor) return;

          const nodeType = MENTION_NODE_TYPES[mention.type];

          const currentSegments = tipTapDocToFullSegments(editor.getJSON());
          const isEffectivelyEmpty = currentSegments.length === 0 ||
            (currentSegments.length === 1 &&
             currentSegments[0].type === 'text' &&
             !currentSegments[0].content.trim());

          if (isEffectivelyEmpty) {
            editor
              .chain()
              .focus()
              .setContent({
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      { type: nodeType, attrs: mention },
                      { type: 'text', text: ' ' },
                    ],
                  },
                ],
              })
              .run();
          } else {
            editor
              .chain()
              .focus()
              .insertContent([
                { type: nodeType, attrs: mention },
                { type: 'text', text: ' ' },
              ])
              .run();
          }
        },

        insertText: (text: string) => {
          editor?.chain().focus().insertContent(text).run();
        },

        getSegments: () => {
          if (!editor) return [];
          return tipTapDocToFullSegments(editor.getJSON());
        },

        isEmpty: () => {
          if (!editor) return true;
          return editor.isEmpty;
        },

        getEditor: () => editor,

        triggerMentionType: (type: 'user' | 'field' | 'model') => {
          if (!editor) return;

          // Focus editor and get current cursor position
          editor.chain().focus().run();
          const cursorPos = editor.state.selection.from;

          // Create a range at the current cursor position (nothing to replace)
          const range = { from: cursorPos, to: cursorPos };

          // Directly set type_selection phase, bypassing command_selection
          setActiveSlashCommand({
            phase: 'type_selection',
            rawQuery: '',
            commandPart: type,
            searchQuery: '',
            selectedType: type,
            range,
            clientRect: null,
          });
          setSelectedItemIndex(0);
        },
      }),
      [editor]
    );

    const segmentsRef = useRef(segments);

    useEffect(() => {
      if (!editor) return;

      const currentSegments = tipTapDocToFullSegments(editor.getJSON());
      const propsChanged = !areSegmentsEqual(segmentsRef.current, segments);
      const editorMatchesProps = areSegmentsEqual(currentSegments, segments);

      if (propsChanged && !editorMatchesProps) {
        const { from, to } = editor.state.selection;

        const doc = segmentsToTipTapDoc(segments);
        editor.commands.setContent(doc, { emitUpdate: false });

        const newDocLength = editor.state.doc.content.size;
        const safeFrom = Math.min(from, newDocLength - 1);
        const safeTo = Math.min(to, newDocLength - 1);
        if (safeFrom > 0) {
          editor.commands.setTextSelection({ from: safeFrom, to: safeTo });
        }
      }

      segmentsRef.current = segments;
    }, [editor, segments]);

    const editorClassName = cn(styles.editor, large && styles.editorLarge);

    return (
      <MentionClickContext.Provider value={mentionClickContextValue}>
        <div style={{ position: 'relative' }}>
          <div className={editorClassName}>
            <EditorContent editor={editor} />
          </div>

          {/* Phase 1: Command selection */}
          {activeSlashCommand?.phase === 'command_selection' && (
            <SlashCommandMenu
              commands={filteredCommands}
              selectedIndex={selectedCommandIndex}
              onSelect={handleSelectCommand}
              onClose={handleCloseDropdown}
              position={dropdownPosition}
            />
          )}

          {/* Phase 2: Type selection - User */}
          {activeSlashCommand?.phase === 'type_selection' &&
            activeSlashCommand.selectedType === 'user' && (
              <UserMentionDropdown
                users={filteredUsers}
                query={activeSlashCommand.searchQuery}
                selectedIndex={selectedItemIndex}
                onSelect={handleSelectUser}
                onClose={handleCloseDropdown}
                position={dropdownPosition}
              />
            )}

          {/* Phase 2: Type selection - Field */}
          {activeSlashCommand?.phase === 'type_selection' &&
            activeSlashCommand.selectedType === 'field' && (
              <FieldMentionDropdown
                fields={filteredFields}
                query={activeSlashCommand.searchQuery}
                selectedIndex={selectedItemIndex}
                onSelect={handleSelectField}
                onClose={handleCloseDropdown}
                pendingFieldForLocale={pendingFieldForLocale}
                onClearPendingField={clearPendingFieldForLocale}
                registerKeyHandler={registerFieldKeyHandler}
                ctx={ctx}
                position={dropdownPosition}
                onPathChange={handleFieldPathChange}
              />
            )}

          {/* Phase 2: Type selection - Model */}
          {activeSlashCommand?.phase === 'type_selection' &&
            activeSlashCommand.selectedType === 'model' && (
              <ModelMentionDropdown
                models={filteredModels}
                query={activeSlashCommand.searchQuery}
                selectedIndex={selectedItemIndex}
                onSelect={handleSelectModel}
                onClose={handleCloseDropdown}
                position={dropdownPosition}
              />
            )}
        </div>
      </MentionClickContext.Provider>
    );
  }
);

TipTapComposer.displayName = 'TipTapComposer';
