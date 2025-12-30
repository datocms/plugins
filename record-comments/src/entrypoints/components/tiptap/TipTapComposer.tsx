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

import { createMentionExtension } from './extensions/createMentionExtension';
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
  tipTapDocToSegments,
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

import styles from './TipTapComposer.module.css';

export type TipTapComposerProps = {
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
};

type ActiveSuggestion = {
  type: 'user' | 'field' | 'model';
  query: string;
  range: { from: number; to: number };
  clientRect: (() => DOMRect | null) | null;
} | null;

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

    const [activeSuggestion, setActiveSuggestion] = useState<ActiveSuggestion>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const activeSuggestionRef = useRef<ActiveSuggestion>(null);

    const fieldKeyHandlerRef = useRef<((key: string) => boolean) | null>(null);
    const [pendingFieldForLocale, setPendingFieldForLocale] = useState<FieldInfo | null>(null);

    useEffect(() => {
      activeSuggestionRef.current = activeSuggestion;
    }, [activeSuggestion]);

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
        activeSuggestionRef.current = null;
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

    const filteredUsers = useMemo(() => {
      if (activeSuggestion?.type !== 'user') return [];
      return filterUsers(projectUsers, activeSuggestion.query);
    }, [projectUsers, activeSuggestion]);

    const filteredFields = useMemo(() => {
      if (activeSuggestion?.type !== 'field') return [];
      return filterFields(modelFields, activeSuggestion.query);
    }, [modelFields, activeSuggestion]);

    const filteredModels = useMemo(() => {
      if (activeSuggestion?.type !== 'model') return [];
      return filterModels(projectModels, activeSuggestion.query);
    }, [projectModels, activeSuggestion]);

    const selectedIndexRef = useRef(0);
    useEffect(() => {
      selectedIndexRef.current = selectedIndex;
    }, [selectedIndex]);

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

    const createSuggestionHandlers = useCallback(
      (mentionType: 'user' | 'field' | 'model', triggerChar: string) => ({
        char: triggerChar,
        allowSpaces: false,

        items: () => [],

        render: () => {
          return {
            onStart: (props: SuggestionProps) => {
              setActiveSuggestion({
                type: mentionType,
                query: props.query,
                range: props.range,
                clientRect: props.clientRect ?? null,
              });
              setSelectedIndex(0);
            },

            onUpdate: (props: SuggestionProps) => {
              setActiveSuggestion({
                type: mentionType,
                query: props.query,
                range: props.range,
                clientRect: props.clientRect ?? null,
              });
              setSelectedIndex(0);
            },

            onExit: () => {
              setActiveSuggestion(null);
              setSelectedIndex(0);
              if (mentionType === 'field') {
                setPendingFieldForLocale(null);
                fieldKeyHandlerRef.current = null;
              }
            },

            onKeyDown: (props: SuggestionKeyDownProps) => {
              const { event, range } = props;
              const query = activeSuggestionRef.current?.query ?? '';

              if (mentionType === 'field' && fieldKeyHandlerRef.current) {
                const handled = fieldKeyHandlerRef.current(event.key);
                if (handled) {
                  event.preventDefault();
                  return true;
                }
              }

              let currentList: UserInfo[] | FieldInfo[] | ModelInfo[] = [];
              if (mentionType === 'user') currentList = filterUsers(projectUsersRef.current, query);
              else if (mentionType === 'field') currentList = filterFields(modelFieldsRef.current, query);
              else if (mentionType === 'model') currentList = filterModels(projectModelsRef.current, query);

              if (event.key === 'ArrowDown') {
                if (currentList.length > 0) {
                  setSelectedIndex((prev) => (prev + 1) % currentList.length);
                }
                return true;
              }

              if (event.key === 'ArrowUp') {
                if (currentList.length > 0) {
                  setSelectedIndex((prev) => (prev - 1 + currentList.length) % currentList.length);
                }
                return true;
              }

              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                const idx = selectedIndexRef.current;
                const selectedItem = currentList[idx];
                const currentEditor = editorRef.current;

                if (selectedItem && currentEditor) {
                  if (mentionType === 'user') {
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
                    setActiveSuggestion(null);
                  } else if (mentionType === 'model') {
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
                    setActiveSuggestion(null);
                  } else if (mentionType === 'field') {
                    const field = selectedItem as FieldInfo;
                    const needsDrillDown = field.isBlockContainer ||
                      (field.localized && field.availableLocales && field.availableLocales.length > 1);

                    if (needsDrillDown) {
                      if (field.localized && field.availableLocales && field.availableLocales.length > 1) {
                        setPendingFieldForLocale(field);
                        setSelectedIndex(0);
                      } else if (field.isBlockContainer) {
                        setPendingFieldForLocale(field);
                        setSelectedIndex(0);
                      }
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
                      setActiveSuggestion(null);
                    }
                  }
                }
                return true;
              }

              if (event.key === 'Escape') {
                setActiveSuggestion(null);
                return true;
              }

              return false;
            },
          };
        },
      }),
      []
    );

    const mentionExtensions = useMemo(() => {
      const extensions = [];

      const UserMention = createMentionExtension({
        name: MENTION_NODE_TYPES.user,
        trigger: '@',
        mentionType: 'user',
        nodeViewComponent: UserMentionNodeView,
      });
      extensions.push(
        UserMention.configure({
          suggestion: createSuggestionHandlers('user', '@'),
        })
      );

      if (canMentionFields && modelFields.length > 0) {
        const FieldMention = createMentionExtension({
          name: MENTION_NODE_TYPES.field,
          trigger: '#',
          mentionType: 'field',
          nodeViewComponent: FieldMentionNodeView,
        });
        extensions.push(
          FieldMention.configure({
            suggestion: createSuggestionHandlers('field', '#'),
          })
        );
      }

      if (canMentionModels) {
        const ModelMention = createMentionExtension({
          name: MENTION_NODE_TYPES.model,
          trigger: '$',
          mentionType: 'model',
          nodeViewComponent: ModelMentionNodeView,
        });
        extensions.push(
          ModelMention.configure({
            suggestion: createSuggestionHandlers('model', '$'),
          })
        );
      }

      const AssetMention = createMentionExtension({
        name: MENTION_NODE_TYPES.asset,
        trigger: '^',
        mentionType: 'asset',
        nodeViewComponent: AssetMentionNodeView,
      });
      extensions.push(AssetMention);

      const RecordMention = createMentionExtension({
        name: MENTION_NODE_TYPES.record,
        trigger: '&',
        mentionType: 'record',
        nodeViewComponent: RecordMentionNodeView,
      });
      extensions.push(RecordMention);

      return extensions;
    }, [canMentionFields, canMentionModels, modelFields, createSuggestionHandlers]);

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
        handleKeyDown: (view, event) => {
          if (event.key === '^' && canMentionAssets && onAssetTriggerRef.current) {
            const assetTriggerCallback = onAssetTriggerRef.current;
            const currentView = view;
            setTimeout(() => {
              try {
                const { state } = currentView;
                const { from } = state.selection;
                if (from > 0) {
                  const tr = state.tr.delete(from - 1, from);
                  currentView.dispatch(tr);
                }
              } catch {
                // Editor may be destroyed
              }
              assetTriggerCallback();
            }, 0);
            return false;
          }

          if (event.key === '&' && onRecordTriggerRef.current) {
            const recordTriggerCallback = onRecordTriggerRef.current;
            const currentView = view;
            setTimeout(() => {
              try {
                const { state } = currentView;
                const { from } = state.selection;
                if (from > 0) {
                  const tr = state.tr.delete(from - 1, from);
                  currentView.dispatch(tr);
                }
              } catch {
                // Editor may be destroyed
              }
              recordTriggerCallback();
            }, 0);
            return false;
          }

          if (event.key === 'Enter' && !event.shiftKey && !activeSuggestion) {
            event.preventDefault();
            onSubmitRef.current?.();
            return true;
          }

          if (event.key === 'Escape' && !activeSuggestion) {
            event.preventDefault();
            onCancelRef.current?.();
            return true;
          }

          return false;
        },
      },
      onUpdate: ({ editor }) => {
        const doc = editor.getJSON();
        const newSegments = tipTapDocToSegments(doc);
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
        const suggestion = activeSuggestionRef.current;
        if (!editor || !suggestion || suggestion.type !== 'user') return;

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
          .deleteRange(suggestion.range)
          .insertContent([
            {
              type: MENTION_NODE_TYPES.user,
              attrs: mention,
            },
            { type: 'text', text: ' ' },
          ])
          .run();

        setActiveSuggestion(null);
      },
      [editor]
    );

    const handleSelectField = useCallback(
      (field: FieldInfo, locale?: string) => {
        const suggestion = activeSuggestionRef.current;
        if (!editor || !suggestion || suggestion.type !== 'field') return;

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
          .deleteRange(suggestion.range)
          .insertContent([
            {
              type: MENTION_NODE_TYPES.field,
              attrs: mention,
            },
            { type: 'text', text: ' ' },
          ])
          .run();

        setActiveSuggestion(null);
      },
      [editor]
    );

    const handleSelectModel = useCallback(
      (model: ModelInfo) => {
        const suggestion = activeSuggestionRef.current;
        if (!editor || !suggestion || suggestion.type !== 'model') return;

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
          .deleteRange(suggestion.range)
          .insertContent([
            {
              type: MENTION_NODE_TYPES.model,
              attrs: mention,
            },
            { type: 'text', text: ' ' },
          ])
          .run();

        setActiveSuggestion(null);
      },
      [editor]
    );

    const handleCloseDropdown = useCallback(() => {
      setActiveSuggestion(null);
    }, []);

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

          const currentSegments = tipTapDocToSegments(editor.getJSON());
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
          return tipTapDocToSegments(editor.getJSON());
        },

        isEmpty: () => {
          if (!editor) return true;
          return editor.isEmpty;
        },

        getEditor: () => editor,
      }),
      [editor]
    );

    const segmentsRef = useRef(segments);

    useEffect(() => {
      if (!editor) return;

      const currentSegments = tipTapDocToSegments(editor.getJSON());
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

    const editorClassName = `${styles.editor}${large ? ` ${styles.editorLarge}` : ''}`;

    return (
      <MentionClickContext.Provider value={mentionClickContextValue}>
        <div style={{ position: 'relative' }}>
          <div className={editorClassName}>
            <EditorContent editor={editor} />
          </div>

          {activeSuggestion?.type === 'user' && (
            <UserMentionDropdown
              users={filteredUsers}
              query={activeSuggestion.query}
              selectedIndex={selectedIndex}
              onSelect={handleSelectUser}
              onClose={handleCloseDropdown}
              position={dropdownPosition}
            />
          )}

        {activeSuggestion?.type === 'field' && (
          <FieldMentionDropdown
            fields={filteredFields}
            query={activeSuggestion.query}
            selectedIndex={selectedIndex}
            onSelect={handleSelectField}
            onClose={handleCloseDropdown}
            pendingFieldForLocale={pendingFieldForLocale}
            onClearPendingField={clearPendingFieldForLocale}
            registerKeyHandler={registerFieldKeyHandler}
            ctx={ctx}
            position={dropdownPosition}
          />
        )}

          {activeSuggestion?.type === 'model' && (
            <ModelMentionDropdown
              models={filteredModels}
              query={activeSuggestion.query}
              selectedIndex={selectedIndex}
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

export default TipTapComposer;
