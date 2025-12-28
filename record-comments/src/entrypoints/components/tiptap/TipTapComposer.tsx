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
import { logError } from '@/utils/errorLogger';

import type { CommentSegment, Mention, UserMention, FieldMention, ModelMention, AssetMention, RecordMention } from '@ctypes/mentions';
import type { UserInfo, FieldInfo, ModelInfo } from '@hooks/useMentions';
import { useNavigationContext } from '@/entrypoints/contexts/NavigationCallbacksContext';

import UserMentionDropdown from '../UserMentionDropdown';
import FieldMentionDropdown from '../FieldMentionDropdown';
import ModelMentionDropdown from '../ModelMentionDropdown';

import styles from './TipTapComposer.module.css';

// ============================================
// Types
// ============================================

/**
 * ARCHITECTURE NOTE: This component is intentionally large (~900 lines) because it
 * encapsulates all TipTap editor functionality including:
 *
 * - Rich text editor initialization and lifecycle management
 * - 5 mention type implementations (user @, field #, asset ^, record &, model $)
 * - Dropdown positioning and keyboard navigation for each mention type
 * - Serialization between TipTap documents and CommentSegment[] format
 * - Node view rendering for each mention type
 *
 * While this creates a large file, the alternative of splitting into smaller components
 * would fragment tightly coupled logic:
 *
 * 1. The TipTap suggestion system requires coordinated state between the editor,
 *    suggestion handlers, and dropdown components.
 *
 * 2. Each mention type shares keyboard navigation logic (arrow keys, enter, escape)
 *    that would need complex prop threading if extracted.
 *
 * 3. The editor lifecycle (useEditor hook) is tightly bound to extension configuration,
 *    making extraction of mention logic impractical.
 *
 * If this component grows further, consider:
 * - Extracting filter/search logic into pure utility functions (already done: filterUsers, filterFields, filterModels)
 * - Moving node view components to separate files (already done: MentionNodeView.tsx)
 * - Creating a custom useTipTapMentions hook if reuse is needed elsewhere
 *
 * CONTEXT DEPENDENCY:
 * This component requires a NavigationCallbacksProvider ancestor in the component tree.
 * It uses `useNavigationContext()` internally for handling mention chip clicks (navigating
 * to users, opening assets, scrolling to fields, etc.). If the context is missing, the
 * component will throw an error.
 *
 * The context is provided by:
 * - SidebarNavigationProvider (wraps CommentsBar in main.tsx)
 * - PageNavigationProvider (wraps CommentsDashboard in main.tsx)
 *
 * This dependency is intentionally hidden inside the component rather than exposed via
 * props because: (1) click handling is a rendering concern, not a data input; (2) the
 * navigation callbacks are already context-based in parent components; (3) exposing 5+
 * navigation callbacks as props would significantly bloat the prop interface.
 */
export type TipTapComposerProps = {
  /** Initial segments to load into the editor */
  segments: CommentSegment[];
  /** Called when content changes */
  onSegmentsChange?: (segments: CommentSegment[]) => void;
  /** Called when Enter is pressed (without Shift) */
  onSubmit?: () => void;
  /** Called when Escape is pressed */
  onCancel?: () => void;
  /** Called when editor loses focus */
  onBlur?: () => void;
  /** Placeholder text */
  placeholder?: string;
  /** Users for @ mentions */
  projectUsers: UserInfo[];
  /** Fields for # mentions (optional - disabled if not provided) */
  modelFields?: FieldInfo[];
  /** Models for $ mentions */
  projectModels: ModelInfo[];
  /** Whether asset mentions (^) are enabled */
  canMentionAssets?: boolean;
  /** Whether model mentions ($) are enabled */
  canMentionModels?: boolean;
  /** Whether field mentions (#) are enabled */
  canMentionFields?: boolean;
  /** Called when asset trigger (^) is detected - should open picker */
  onAssetTrigger?: () => void;
  /** Called when record trigger (&) is detected - should open picker */
  onRecordTrigger?: () => void;
  /** Auto-focus on mount */
  autoFocus?: boolean;
  /** Use larger styling (for dashboard) */
  large?: boolean;
  /** Position dropdowns above or below */
  dropdownPosition?: 'above' | 'below';
  /** Plugin context for field mention drill-down (loading blocks) */
  ctx?: RenderItemFormSidebarCtx;
};

export type TipTapComposerRef = {
  /** Focus the editor */
  focus: () => void;
  /** Clear the editor content */
  clear: () => void;
  /** Insert a mention at current cursor position */
  insertMention: (mention: Mention) => void;
  /** Insert text at current cursor position */
  insertText: (text: string) => void;
  /** Get current segments */
  getSegments: () => CommentSegment[];
  /** Check if editor is empty */
  isEmpty: () => boolean;
  /** Get the editor instance */
  getEditor: () => Editor | null;
};

// ============================================
// Suggestion State Types
// ============================================

type ActiveSuggestion = {
  type: 'user' | 'field' | 'model';
  query: string;
  range: { from: number; to: number };
  clientRect: (() => DOMRect | null) | null;
} | null;

// ============================================
// Component
// ============================================

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
    // Get navigation callbacks from context
    const nav = useNavigationContext();
    // ============================================
    // Suggestion State
    // ============================================
    const [activeSuggestion, setActiveSuggestion] = useState<ActiveSuggestion>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    // Store suggestion in a ref so it persists through blur/focus cycles
    const activeSuggestionRef = useRef<ActiveSuggestion>(null);

    // Field dropdown keyboard handler and pending field for locale selection
    const fieldKeyHandlerRef = useRef<((key: string) => boolean) | null>(null);
    const [pendingFieldForLocale, setPendingFieldForLocale] = useState<FieldInfo | null>(null);

    // Keep ref in sync with state
    useEffect(() => {
      activeSuggestionRef.current = activeSuggestion;
    }, [activeSuggestion]);

    // Refs for stable callbacks
    const onSubmitRef = useRef(onSubmit);
    const onCancelRef = useRef(onCancel);
    const onBlurRef = useRef(onBlur);
    const onAssetTriggerRef = useRef(onAssetTrigger);
    const onRecordTriggerRef = useRef(onRecordTrigger);
    const onSegmentsChangeRef = useRef(onSegmentsChange);

    // Mounted guard to prevent updates after unmount (for setTimeout safety)
    const isMountedRef = useRef(true);

    // Cleanup on unmount
    // NOTE: We intentionally do NOT call editor.destroy() here because:
    // 1. The useEditor hook from @tiptap/react handles cleanup automatically
    // 2. Calling destroy() manually can cause "Cannot read properties of null" errors
    //    when the editor is already being destroyed by the hook
    // 3. The useEditor hook returns null on unmount and handles DOM cleanup internally
    //
    // See: https://tiptap.dev/docs/editor/api/utilities/use-editor
    // The hook documentation confirms: "The editor instance is automatically destroyed
    // when the component is unmounted."
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

    // Refs for data to prevent extension recreation on data changes
    const projectUsersRef = useRef(projectUsers);
    const modelFieldsRef = useRef(modelFields);
    const projectModelsRef = useRef(projectModels);

    useEffect(() => {
      projectUsersRef.current = projectUsers;
      modelFieldsRef.current = modelFields;
      projectModelsRef.current = projectModels;
    }, [projectUsers, modelFields, projectModels]);

    // ============================================
    // Filtered Lists
    // ============================================
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

    // Refs for selection handlers (needed for keyboard selection)
    const selectedIndexRef = useRef(0);
    useEffect(() => {
      selectedIndexRef.current = selectedIndex;
    }, [selectedIndex]);

    // Editor ref for keyboard selection (editor not available during extension creation)
    const editorRef = useRef<Editor | null>(null);

    // Callback to register field dropdown's keyboard handler
    const registerFieldKeyHandler = useCallback((handler: (key: string) => boolean) => {
      fieldKeyHandlerRef.current = handler;
    }, []);

    // Clear pending field for locale
    const clearPendingFieldForLocale = useCallback(() => {
      setPendingFieldForLocale(null);
    }, []);

    /**
     * Unified mention click handler for chips in the editor.
     *
     * TYPE ASSERTION RATIONALE:
     * -------------------------
     * The type assertions (e.g., `mention as FieldMention`) after switch cases are SAFE
     * because the switch statement narrows by `mention.type`, which is a discriminated
     * union. TypeScript knows that inside `case 'field':`, the mention MUST be a FieldMention.
     *
     * However, TypeScript 5.x sometimes doesn't narrow properly in all contexts (especially
     * when destructuring or passing to functions), so explicit assertions are used for clarity.
     *
     * WHY NOT USE TYPE GUARDS (isFieldMention, etc.):
     * - The switch already provides compile-time type narrowing
     * - Adding runtime type guards would duplicate the discrimination logic
     * - No safety benefit: if `mention.type === 'field'`, it IS a FieldMention by definition
     * - Type guards from types/mentions.ts exist for use in other contexts where
     *   the discriminant isn't already checked
     *
     * DO NOT add isFieldMention() etc. checks here - they would be pure overhead.
     */
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

    // Context value for mention click handling
    const mentionClickContextValue = useMemo(
      () => ({ onMentionClick: handleMentionClick }),
      [handleMentionClick]
    );

    // ============================================
    // Suggestion Handlers
    // ============================================
    const createSuggestionHandlers = useCallback(
      (mentionType: 'user' | 'field' | 'model', triggerChar: string) => ({
        char: triggerChar,
        allowSpaces: false,

        items: () => {
          // Return empty - we manage filtering ourselves
          return [];
        },

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

              // For field mentions with pending locale selection, delegate to dropdown handler
              if (mentionType === 'field' && fieldKeyHandlerRef.current) {
                const handled = fieldKeyHandlerRef.current(event.key);
                if (handled) {
                  event.preventDefault();
                  return true;
                }
              }

              // Get current list for navigation (using refs for stable data access)
              let currentList: UserInfo[] | FieldInfo[] | ModelInfo[] = [];
              if (mentionType === 'user') currentList = filterUsers(projectUsersRef.current, query);
              else if (mentionType === 'field') currentList = filterFields(modelFieldsRef.current, query);
              else if (mentionType === 'model') currentList = filterModels(projectModelsRef.current, query);

              if (event.key === 'ArrowDown') {
                setSelectedIndex((prev) => Math.min(prev + 1, currentList.length - 1));
                return true;
              }

              if (event.key === 'ArrowUp') {
                setSelectedIndex((prev) => Math.max(prev - 1, 0));
                return true;
              }

              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                const idx = selectedIndexRef.current;
                const selectedItem = currentList[idx];
                const currentEditor = editorRef.current;

                if (selectedItem && currentEditor) {
                  /**
                   * TYPE ASSERTION RATIONALE (Keyboard Selection):
                   * -----------------------------------------------
                   * The assertions below (e.g., `selectedItem as UserInfo`) are SAFE because:
                   *
                   * 1. `currentList` is set based on `mentionType` (lines 388-391 above)
                   *    - If mentionType === 'user', currentList = filterUsers(...) → UserInfo[]
                   *    - If mentionType === 'field', currentList = filterFields(...) → FieldInfo[]
                   *    - If mentionType === 'model', currentList = filterModels(...) → ModelInfo[]
                   *
                   * 2. `selectedItem` comes from `currentList[idx]`, so it inherits the type
                   *
                   * 3. The if statements on `mentionType` correctly narrow which assertion to use
                   *
                   * TypeScript can't automatically narrow `selectedItem` because `mentionType`
                   * is a string parameter, not a discriminant property on `selectedItem` itself.
                   * Adding runtime type guards would require checking properties on each item type
                   * (e.g., checking if 'email' exists for UserInfo), which adds overhead without
                   * any practical safety benefit - the mentionType discrimination is already correct.
                   *
                   * DO NOT add property-based type guards here - the mentionType check is sufficient.
                   */
                  // Insert the mention based on type
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
                    // Check if field needs drill-down (localized or block container)
                    const needsDrillDown = field.isBlockContainer ||
                      (field.localized && field.availableLocales && field.availableLocales.length > 1);

                    if (needsDrillDown) {
                      // Set pending field to trigger locale picker in dropdown
                      if (field.localized && field.availableLocales && field.availableLocales.length > 1) {
                        setPendingFieldForLocale(field);
                        setSelectedIndex(0); // Reset selection for locale list
                      } else if (field.isBlockContainer) {
                        // For block containers, also set pending to trigger navigation
                        setPendingFieldForLocale(field);
                        setSelectedIndex(0);
                      }
                    } else {
                      // Simple field - insert directly
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
      [] // Dependencies removed - using refs for data access to prevent extension recreation
    );

    // ============================================
    // Mention Extensions
    // ============================================
    const mentionExtensions = useMemo(() => {
      const extensions = [];

      // User mentions (@)
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

      // Field mentions (#) - only if enabled
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

      // Model mentions ($) - only if enabled
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

      // Asset mention extension (no suggestion - uses picker)
      const AssetMention = createMentionExtension({
        name: MENTION_NODE_TYPES.asset,
        trigger: '^',
        mentionType: 'asset',
        nodeViewComponent: AssetMentionNodeView,
      });
      extensions.push(AssetMention);

      // Record mention extension (no suggestion - uses picker)
      const RecordMention = createMentionExtension({
        name: MENTION_NODE_TYPES.record,
        trigger: '&',
        mentionType: 'record',
        nodeViewComponent: RecordMentionNodeView,
      });
      extensions.push(RecordMention);

      return extensions;
    }, [canMentionFields, canMentionModels, modelFields, createSuggestionHandlers]);

    // ============================================
    // Editor Setup
    // ============================================
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Disable features we don't need
          blockquote: false,
          bulletList: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          listItem: false,
          orderedList: false,
          // Keep paragraph and hardBreak for basic formatting
          paragraph: {},
          hardBreak: {},
          // Disable marks
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
          // Handle asset trigger (^)
          if (event.key === '^' && canMentionAssets && onAssetTriggerRef.current) {
            // Let the character be typed, then trigger picker
            const currentView = view;
            setTimeout(() => {
              // Guard: skip if component unmounted
              if (!isMountedRef.current) return;
              try {
                // Remove the ^ character
                const { state } = currentView;
                const { from } = state.selection;
                if (from > 0) {
                  const tr = state.tr.delete(from - 1, from);
                  currentView.dispatch(tr);
                }
              } catch (error) {
                // Editor may have been destroyed during the setTimeout delay.
                // This is expected during rapid navigation or component unmounting.
                logError('Failed to remove asset trigger character from editor', error, {
                  reason: 'Editor likely destroyed during setTimeout delay',
                });
              }
              // Trigger asset picker
              onAssetTriggerRef.current?.();
            }, 0);
            return false;
          }

          // Handle record trigger (&)
          if (event.key === '&' && onRecordTriggerRef.current) {
            // Let the character be typed, then trigger picker
            const currentView = view;
            setTimeout(() => {
              // Guard: skip if component unmounted
              if (!isMountedRef.current) return;
              try {
                // Remove the & character
                const { state } = currentView;
                const { from } = state.selection;
                if (from > 0) {
                  const tr = state.tr.delete(from - 1, from);
                  currentView.dispatch(tr);
                }
              } catch (error) {
                // Editor may have been destroyed during the setTimeout delay.
                // This is expected during rapid navigation or component unmounting.
                logError('Failed to remove record trigger character from editor', error, {
                  reason: 'Editor likely destroyed during setTimeout delay',
                });
              }
              // Trigger record picker
              onRecordTriggerRef.current?.();
            }, 0);
            return false;
          }

          // Handle Enter (submit) - only when no suggestion is active
          if (event.key === 'Enter' && !event.shiftKey && !activeSuggestion) {
            event.preventDefault();
            onSubmitRef.current?.();
            return true;
          }

          // Handle Escape
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

    // Keep editorRef in sync for keyboard selection handlers
    useEffect(() => {
      editorRef.current = editor;
    }, [editor]);

    // ============================================
    // Selection Handlers
    // ============================================
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

    // ============================================
    // Ref API
    // ============================================
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

          // Check if editor has no meaningful content (no text, no existing mentions)
          // editor.isEmpty can be unreliable after typing/deleting characters
          const currentSegments = tipTapDocToSegments(editor.getJSON());
          const isEffectivelyEmpty = currentSegments.length === 0 ||
            (currentSegments.length === 1 &&
             currentSegments[0].type === 'text' &&
             !currentSegments[0].content.trim());

          // If editor is effectively empty, set content directly to avoid empty paragraph before mention
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

    // ============================================
    // Sync segments on external change
    // ============================================
    const segmentsRef = useRef(segments);

    useEffect(() => {
      if (!editor) return;

      // Only update if segments actually changed (not from our own onUpdate)
      const currentSegments = tipTapDocToSegments(editor.getJSON());
      const propsChanged = !areSegmentsEqual(segmentsRef.current, segments);
      const editorMatchesProps = areSegmentsEqual(currentSegments, segments);

      // Only sync if props changed AND editor doesn't already match
      if (propsChanged && !editorMatchesProps) {
        // Store cursor position
        const { from, to } = editor.state.selection;

        const doc = segmentsToTipTapDoc(segments);
        editor.commands.setContent(doc, { emitUpdate: false });

        // Restore cursor if within bounds
        const newDocLength = editor.state.doc.content.size;
        const safeFrom = Math.min(from, newDocLength - 1);
        const safeTo = Math.min(to, newDocLength - 1);
        if (safeFrom > 0) {
          editor.commands.setTextSelection({ from: safeFrom, to: safeTo });
        }
      }

      segmentsRef.current = segments;
    }, [editor, segments]);

    // ============================================
    // Render
    // ============================================
    const editorClassName = `${styles.editor}${large ? ` ${styles.editorLarge}` : ''}`;

    return (
      <MentionClickContext.Provider value={mentionClickContextValue}>
        <div style={{ position: 'relative' }}>
          <div className={editorClassName}>
            <EditorContent editor={editor} />
          </div>

          {/* User Mention Dropdown */}
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

        {/* Field Mention Dropdown */}
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

          {/* Model Mention Dropdown */}
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
