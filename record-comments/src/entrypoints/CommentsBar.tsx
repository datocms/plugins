import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { buildClient } from '@datocms/cma-client-browser';
import { useQuerySubscription } from 'react-datocms';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Textarea from 'react-textarea-autosize';
import Comment from './components/Comment';
import FieldMentionDropdown from './components/FieldMentionDropdown';
import UserMentionDropdown from './components/UserMentionDropdown';
import ModelMentionDropdown from './components/ModelMentionDropdown';
import { useMentions, type UserInfo, type FieldInfo, type ModelInfo } from './hooks/useMentions';
import type { AssetMention, CommentSegment, Mention, MentionMapKey, RecordMention } from './types/mentions';
import { editableTextToSegments, insertToolbarMention } from './utils/mentionSerializer';
import { loadAllFields } from './utils/fieldLoader';
import RecordModelSelectorDropdown from './components/RecordModelSelectorDropdown';
import styles from './styles/commentbar.module.css';
import { COMMENTS_MODEL_API_KEY } from '../constants';
import { getGravatarUrl, getThumbnailUrl } from '../utils/helpers';

// Re-export types for use by other components
export type { UserInfo, FieldInfo, ModelInfo } from './hooks/useMentions';
export type { CommentSegment, Mention } from './types/mentions';

type Props = {
  ctx: RenderItemFormSidebarCtx;
};

export type Upvoter = { name: string; email: string };

export type CommentType = {
  dateISO: string;
  content: CommentSegment[];
  author: { name: string; email: string };
  usersWhoUpvoted: Upvoter[];
  replies?: CommentType[];
  parentCommentISO?: string;
};

const COMMENTS_QUERY = `
  query CommentsQuery($modelId: String!, $recordId: String!) {
    allProjectComments(filter: { modelId: { eq: $modelId }, recordId: { eq: $recordId } }, first: 1) {
      id
      content
    }
  }
`;

type QueryResult = {
  allProjectComments: Array<{
    id: string;
    content: string | CommentType[] | null;
  }>;
};

const getUserInfo = (user: RenderItemFormSidebarCtx['currentUser']) => {
  const attrs = user.attributes as Record<string, unknown>;
  const email = (attrs.email as string) ?? 'unknown@email.com';
  const name =
    (attrs.full_name as string) ?? (attrs.name as string) ?? email.split('@')[0];
  return { email, name };
};

const parseComments = (content: string | CommentType[] | null): CommentType[] => {
  if (!content) return [];
  if (Array.isArray(content)) return content;
  try {
    return JSON.parse(content);
  } catch {
    return [];
  }
};

const CommentsBar = ({ ctx }: Props) => {
  const { email: userEmail, name: userName } = getUserInfo(ctx.currentUser);

  const [comments, setComments] = useState<CommentType[]>([]);
  const [commentsModelId, setCommentsModelId] = useState<string | null>(null);
  const [commentRecordId, setCommentRecordId] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState('');
  const [composerMentionsMap, setComposerMentionsMap] = useState<Map<MentionMapKey, Mention>>(
    () => new Map()
  );
  const [modelFields, setModelFields] = useState<FieldInfo[]>([]);
  const [projectUsers, setProjectUsers] = useState<UserInfo[]>([]);
  const [projectModels, setProjectModels] = useState<ModelInfo[]>([]);
  const [isRecordModelSelectorOpen, setIsRecordModelSelectorOpen] = useState(false);

  const isSaving = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const cmaToken = ctx.currentUserAccessToken;
  const pluginParams = ctx.plugin.attributes.parameters as { cdaToken?: string };
  const cdaToken = pluginParams.cdaToken;

  const client = useMemo(
    () => (cmaToken ? buildClient({ apiToken: cmaToken }) : null),
    [cmaToken]
  );

  // Unified mentions hook for composer
  const {
    activeDropdown,
    filteredUsers,
    filteredFields,
    filteredModels,
    selectedIndex,
    triggerInfo,
    handleKeyDown: handleMentionKeyDown,
    handleChange: handleMentionChange,
    handleSelectUser,
    handleSelectField,
    handleSelectModel,
    closeDropdown,
    cursorPosition,
    setCursorPosition,
    pendingFieldForLocale,
    clearPendingFieldForLocale,
  } = useMentions({
    users: projectUsers,
    fields: modelFields,
    models: projectModels,
    value: composerValue,
    onChange: setComposerValue,
    mentionsMap: composerMentionsMap,
    onMentionsMapChange: setComposerMentionsMap,
  });

  // Refs for asset picker trigger handling
  const isAssetPickerOpen = useRef(false);
  const composerValueRef = useRef(composerValue);
  const cursorPositionRef = useRef(cursorPosition);
  
  // Keep refs in sync
  useEffect(() => {
    composerValueRef.current = composerValue;
  }, [composerValue]);
  
  useEffect(() => {
    cursorPositionRef.current = cursorPosition;
  }, [cursorPosition]);

  // Handle asset trigger (^) - opens the asset picker immediately
  useEffect(() => {
    if (activeDropdown !== 'asset' || !triggerInfo || isAssetPickerOpen.current) return;

    isAssetPickerOpen.current = true;

    const openAssetPicker = async () => {
      // Capture current values from refs
      const currentValue = composerValueRef.current;
      const currentCursorPos = cursorPositionRef.current;
      const triggerStartIndex = triggerInfo.startIndex;

      // Remove the ^ trigger from text
      const before = currentValue.slice(0, triggerStartIndex);
      const after = currentValue.slice(currentCursorPos);
      setComposerValue(before + after);
      setCursorPosition(triggerStartIndex);

      // Open the asset picker
      const upload = await ctx.selectUpload({ multiple: false });

      isAssetPickerOpen.current = false;

      if (!upload) {
        // User cancelled - just focus back on textarea
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 0);
        return;
      }

      const mimeType = upload.attributes.mime_type ?? 'application/octet-stream';
      const url = upload.attributes.url ?? '';
      const thumbnailUrl = getThumbnailUrl(mimeType, url, upload.attributes.mux_playback_id);

      const assetMention: AssetMention = {
        type: 'asset',
        id: upload.id,
        filename: upload.attributes.filename,
        url,
        thumbnailUrl,
        mimeType,
      };

      // Insert the mention at the trigger position
      const mentionText = `^${upload.id} `;
      const newText = before + mentionText + after;
      const newCursorPosition = triggerStartIndex + mentionText.length;

      // Update state
      setComposerMentionsMap((prevMap) => {
        const newMap = new Map(prevMap);
        newMap.set(`asset:${upload.id}`, assetMention);
        return newMap;
      });
      setComposerValue(newText);

      // Focus textarea and update cursor
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
          setCursorPosition(newCursorPosition);
        }
      }, 0);
    };

    openAssetPicker();
  }, [activeDropdown, triggerInfo, ctx, setCursorPosition]);

  // Realtime subscription
  const { data, status, error } = useQuerySubscription<QueryResult>({
    query: COMMENTS_QUERY,
    variables: { modelId: ctx.itemType.id, recordId: ctx.item?.id ?? '' },
    token: cdaToken ?? '',
    enabled: !!ctx.item?.id && !!cdaToken,
    includeDrafts: true,
  });

  // Initialize model ID
  useEffect(() => {
    client?.itemTypes.list().then((models) => {
      const model = models.find((m) => m.api_key === COMMENTS_MODEL_API_KEY);
      if (model) setCommentsModelId(model.id);
    });
  }, [client]);

  // Load fields for the current model (for field mentions)
  // This loads top-level fields and recursively loads nested fields from modular content/structured text
  useEffect(() => {
    loadAllFields(ctx).then((fieldInfos) => {
      setModelFields(fieldInfos);
    });
  }, [ctx, ctx.itemType.id, ctx.formValues]);

  // Load users for the project (for user mentions)
  useEffect(() => {
    const loadAllUsers = async () => {
      const [regularUsers, ssoUsers] = await Promise.all([
        ctx.loadUsers(),
        ctx.loadSsoUsers(),
      ]);

      const allUsers: UserInfo[] = [
        ...regularUsers.map((user) => ({
          id: user.id,
          email: user.attributes.email,
          name: user.attributes.full_name ?? user.attributes.email.split('@')[0],
          avatarUrl: getGravatarUrl(user.attributes.email, 48),
        })),
        ...ssoUsers.map((user) => {
          const email = user.attributes.username;
          const firstName = user.attributes.first_name ?? '';
          const lastName = user.attributes.last_name ?? '';
          const fullName = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];
          return {
            id: user.id,
            email,
            name: fullName,
            avatarUrl: getGravatarUrl(email, 48),
          };
        }),
      ];

      setProjectUsers(allUsers);
    };

    loadAllUsers();
  }, [ctx]);

  // Load models for the project (for model mentions)
  useEffect(() => {
    const itemTypesMap = ctx.itemTypes;
    const modelInfos: ModelInfo[] = Object.values(itemTypesMap)
      .filter((itemType): itemType is NonNullable<typeof itemType> => itemType !== undefined)
      .map((itemType) => ({
        id: itemType.id,
        apiKey: itemType.attributes.api_key,
        name: itemType.attributes.name,
        isBlockModel: itemType.attributes.modular_block,
      }));
    setProjectModels(modelInfos);
  }, [ctx.itemTypes]);

  // Sync subscription data to local state
  useEffect(() => {
    const record = data?.allProjectComments[0];
    if (!record || isSaving.current) return;

    setCommentRecordId(record.id);
    setComments(parseComments(record.content));
  }, [data]);

  // Save comments to CMA
  const saveComments = useCallback(
    async (commentsToSave: CommentType[]) => {
      if (!client || !ctx.item?.id || !commentsModelId) return;

      isSaving.current = true;
      const content = JSON.stringify(commentsToSave);

      try {
        if (commentRecordId) {
          await client.items.update(commentRecordId, { content });
        } else if (commentsToSave.length > 0) {
          const newRecord = await client.items.create({
            item_type: { type: 'item_type', id: commentsModelId },
            model_id: ctx.itemType.id,
            record_id: ctx.item.id,
            content,
          });
          setCommentRecordId(newRecord.id);
        }
      } finally {
        setTimeout(() => {
          isSaving.current = false;
        }, 1000);
      }
    },
    [client, ctx.item?.id, ctx.itemType.id, commentsModelId, commentRecordId]
  );

  // Update and immediately save
  const updateAndSave = useCallback(
    (updater: (prev: CommentType[]) => CommentType[]) => {
      setComments((prev) => {
        const newComments = updater(prev);
        saveComments(newComments);
        return newComments;
      });
    },
    [saveComments]
  );

  const submitNewComment = () => {
    if (!composerValue.trim()) return;
    
    if (!ctx.item?.id) {
      ctx.alert('Please save the record first before adding comments.');
      return;
    }

    // Convert editable text to structured segments
    const content = editableTextToSegments(composerValue, composerMentionsMap);

    const newComment: CommentType = {
      dateISO: new Date().toISOString(),
      content,
      author: { name: userName, email: userEmail },
      usersWhoUpvoted: [],
      replies: [],
    };

    updateAndSave((prev) => [newComment, ...prev]);
    setComposerValue('');
    setComposerMentionsMap(new Map());
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Let mention system handle keys first if a dropdown is open
    if (activeDropdown) {
      const handled = handleMentionKeyDown(e);
      if (handled) return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitNewComment();
    }
  };

  const deleteComment = (dateISO: string, parentCommentISO = '') => {
    updateAndSave((prev) => {
      if (parentCommentISO) {
        return prev.map((c) =>
          c.dateISO === parentCommentISO
            ? { ...c, replies: c.replies?.filter((r) => r.dateISO !== dateISO) }
            : c
        );
      }
      return prev.filter((c) => c.dateISO !== dateISO);
    });
  };

  // Edit and save comment (called when user presses Enter)
  const editComment = (dateISO: string, newContent: CommentSegment[], parentCommentISO = '') => {
    updateAndSave((prev) => {
      if (parentCommentISO) {
        return prev.map((c) =>
          c.dateISO === parentCommentISO
            ? {
                ...c,
                replies: c.replies?.map((r) =>
                  r.dateISO === dateISO ? { ...r, content: newContent } : r
                ),
              }
            : c
        );
      }
      return prev.map((c) =>
        c.dateISO === dateISO ? { ...c, content: newContent } : c
      );
    });
  };

  const upvoteComment = (
    dateISO: string,
    userUpvoted: boolean,
    parentCommentISO = ''
  ) => {
    const toggleUpvote = (voters: (string | Upvoter)[]) => {
      if (userUpvoted) {
        return voters.filter((u) => 
          typeof u === 'string' ? u !== userEmail : u.email !== userEmail
        ) as Upvoter[];
      }
      const normalized = voters.map(u => 
        typeof u === 'string' ? { name: u.split('@')[0], email: u } : u
      );
      return [...normalized, { name: userName, email: userEmail }];
    };

    updateAndSave((prev) => {
      if (parentCommentISO) {
        return prev.map((c) =>
          c.dateISO === parentCommentISO
            ? {
                ...c,
                replies: c.replies?.map((r) =>
                  r.dateISO === dateISO
                    ? { ...r, usersWhoUpvoted: toggleUpvote(r.usersWhoUpvoted) }
                    : r
                ),
              }
            : c
        );
      }
      return prev.map((c) =>
        c.dateISO === dateISO
          ? { ...c, usersWhoUpvoted: toggleUpvote(c.usersWhoUpvoted) }
          : c
      );
    });
  };

  const replyComment = (parentCommentISO: string) => {
    // Add empty reply - user will save when they press Enter
    setComments((prev) =>
      prev.map((c) =>
        c.dateISO === parentCommentISO
          ? {
              ...c,
              replies: [
                {
                  dateISO: new Date().toISOString(),
                  content: [], // Empty content for new reply
                  author: { name: userName, email: userEmail },
                  usersWhoUpvoted: [],
                  parentCommentISO,
                },
                ...(c.replies ?? []),
              ],
            }
          : c
      )
    );
  };

  const handleScrollToField = useCallback(
    async (fieldPath: string, localized: boolean, locale?: string) => {
      try {
        const modelId = ctx.itemType.id;
        const recordId = ctx.item?.id;
        
        if (!recordId) {
          // Record not saved yet
          return;
        }
        
        if (localized) {
          // For localized fields:
          // 1. First use scrollToField to switch to the correct locale
          const effectiveLocale = locale ?? ctx.locale;
          await ctx.scrollToField(fieldPath, effectiveLocale);
          
          // 2. Then navigate with the hash to highlight/expand the field
          const fullPath = `${fieldPath}.${effectiveLocale}`;
          const path = `/editor/item_types/${modelId}/items/${recordId}/edit#fieldPath=${fullPath}`;
          await ctx.navigateTo(path);
        } else {
          // For non-localized fields, just use the hash navigation
          const path = `/editor/item_types/${modelId}/items/${recordId}/edit#fieldPath=${fieldPath}`;
          await ctx.navigateTo(path);
        }
      } catch {
        // Silently fail - field might not exist or be hidden
      }
    },
    [ctx]
  );

  const handleNavigateToUsers = useCallback(async () => {
    await ctx.navigateTo('/project_settings/users');
  }, [ctx]);

  // Factory for toolbar trigger handlers (@ for user, # for field, $ for model)
  const createToolbarTriggerHandler = useCallback(
    (triggerChar: string) => () => {
      const newValue = `${composerValue}${triggerChar}`;
      setComposerValue(newValue);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const pos = newValue.length;
          textareaRef.current.setSelectionRange(pos, pos);
          setCursorPosition(pos);
        }
      }, 0);
    },
    [composerValue, setCursorPosition]
  );

  const handleUserToolbarClick = createToolbarTriggerHandler('@');
  const handleFieldToolbarClick = createToolbarTriggerHandler('#');

  // Open the model selector dropdown for record mentions
  const handleRecordClick = useCallback(() => {
    setIsRecordModelSelectorOpen(true);
  }, []);

  // Handle model selection for record mentions - then open the record picker
  const handleRecordModelSelect = useCallback(
    async (model: ModelInfo) => {
      setIsRecordModelSelectorOpen(false);
      
      // Capture trigger info before opening record picker (it may change)
      const currentTriggerInfo = triggerInfo;

      // Open DatoCMS record picker for the selected model
      const record = await ctx.selectItem(model.id, { multiple: false });

      if (!record) {
        // User cancelled - focus back on textarea
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 0);
        return;
      }

      // Get the record title from the presentation_title_field
      let recordTitle = `Record #${record.id}`;
      let recordThumbnailUrl: string | null = null;

      // Get the full model data to find the presentation fields
      const itemType = ctx.itemTypes[model.id];
      if (itemType) {
        // Load the model's fields once for both title and image
        const fields = await ctx.loadItemTypeFields(model.id);
        const mainLocale = ctx.site.attributes.locales[0];

        // Get presentation title (fallback to title_field if not available)
        const presentationTitleFieldId = itemType.relationships.presentation_title_field.data?.id;
        const titleFieldId = itemType.relationships.title_field.data?.id;
        const selectedTitleFieldId = presentationTitleFieldId ?? titleFieldId;

        if (selectedTitleFieldId) {
          const titleField = fields.find((f) => f.id === selectedTitleFieldId);

          if (titleField) {
            const fieldApiKey = titleField.attributes.api_key;
            const fieldValue = record.attributes[fieldApiKey];

            // Handle localized fields (value is an object with locale keys)
            if (fieldValue !== null && fieldValue !== undefined) {
              if (typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
                // Localized field - get the main locale value
                const localizedValue = (fieldValue as Record<string, unknown>)[mainLocale];
                if (localizedValue) {
                  recordTitle = String(localizedValue);
                }
              } else {
                recordTitle = String(fieldValue);
              }
            }
          }
        }

        // Get presentation image thumbnail (fallback to image_preview_field if not available)
        const presentationImageFieldId = itemType.relationships.presentation_image_field.data?.id;
        const imagePreviewFieldId = itemType.relationships.image_preview_field.data?.id;
        const imageFieldId = presentationImageFieldId ?? imagePreviewFieldId;

        // Helper to extract thumbnail URL from a field
        const extractThumbnailFromField = async (field: typeof fields[0]) => {
          const fieldApiKey = field.attributes.api_key;
          let fieldValue = record.attributes[fieldApiKey];

          // Handle localized fields
          if (fieldValue !== null && fieldValue !== undefined) {
            if (typeof fieldValue === 'object' && !Array.isArray(fieldValue) && !('upload_id' in fieldValue)) {
              // Localized field - get the main locale value
              fieldValue = (fieldValue as Record<string, unknown>)[mainLocale];
            }
          }

          // Extract upload ID from field value
          let uploadId: string | null = null;

          if (fieldValue) {
            if (Array.isArray(fieldValue)) {
              // Asset gallery - use first item
              const firstAsset = fieldValue[0];
              if (firstAsset && typeof firstAsset === 'object' && 'upload_id' in firstAsset) {
                uploadId = (firstAsset as { upload_id: string }).upload_id;
              }
            } else if (typeof fieldValue === 'object' && 'upload_id' in fieldValue) {
              // Single asset field
              uploadId = (fieldValue as { upload_id: string }).upload_id;
            }
          }

          // Fetch upload details to get URL
          if (uploadId && client) {
            try {
              const upload = await client.uploads.find(uploadId);
              const mimeType = upload.mime_type ?? '';
              const url = upload.url ?? '';
              return getThumbnailUrl(mimeType, url, upload.mux_playback_id);
            } catch {
              // Silently fail - thumbnail is optional
            }
          }
          return null;
        };

        // Try configured image fields first
        if (imageFieldId) {
          const imageField = fields.find((f) => f.id === imageFieldId);
          if (imageField) {
            recordThumbnailUrl = await extractThumbnailFromField(imageField);
          }
        }

        // Fallback: find first file or gallery field if no thumbnail found
        if (!recordThumbnailUrl) {
          // Sort fields by position and find first file/gallery field
          const sortedFields = [...fields].sort(
            (a, b) => (a.attributes.position ?? 0) - (b.attributes.position ?? 0)
          );
          const firstImageField = sortedFields.find((f) => {
            const fieldType = f.attributes.field_type;
            return fieldType === 'file' || fieldType === 'gallery';
          });

          if (firstImageField) {
            recordThumbnailUrl = await extractThumbnailFromField(firstImageField);
          }
        }
      }

      // Get model emoji if available (icon is not in TypeScript types but exists in API)
      const modelEmoji = (itemType?.attributes as Record<string, unknown>)?.icon as string | null ?? null;

      // Create record mention with actual title and thumbnail
      const recordMention: RecordMention = {
        type: 'record',
        id: record.id,
        title: recordTitle,
        modelId: model.id,
        modelApiKey: model.apiKey,
        modelName: model.name,
        modelEmoji,
        thumbnailUrl: recordThumbnailUrl,
      };

      // Insert the mention - handle both toolbar click and & trigger
      let newText: string;
      let newCursorPosition: number;
      
      if (currentTriggerInfo?.type === 'record') {
        // Triggered by typing & - replace the trigger text with the mention
        const before = composerValue.slice(0, currentTriggerInfo.startIndex);
        const after = composerValue.slice(cursorPosition);
        const mentionText = `&${record.id} `;
        newText = before + mentionText + after;
        newCursorPosition = currentTriggerInfo.startIndex + mentionText.length;
      } else {
        // Triggered by toolbar click - insert at cursor position
        const result = insertToolbarMention(
          composerValue,
          cursorPosition,
          recordMention
        );
        newText = result.newText;
        newCursorPosition = result.newCursorPosition;
      }

      // Update state
      const newMap = new Map(composerMentionsMap);
      newMap.set(`record:${record.id}`, recordMention);
      setComposerMentionsMap(newMap);
      setComposerValue(newText);

      // Focus textarea and update cursor
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
          setCursorPosition(newCursorPosition);
        }
      }, 0);
    },
    [ctx, client, composerValue, cursorPosition, composerMentionsMap, setCursorPosition, triggerInfo]
  );

  // Close record model selector
  const handleRecordModelSelectorClose = useCallback(() => {
    setIsRecordModelSelectorOpen(false);
    
    // If triggered by typing &, close the dropdown properly
    if (triggerInfo?.type === 'record') {
      closeDropdown();
    }
    
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, [triggerInfo, closeDropdown]);

  const handleAssetClick = useCallback(async () => {
    const upload = await ctx.selectUpload({ multiple: false });

    if (!upload) {
      // User cancelled - do nothing
      return;
    }

    const mimeType = upload.attributes.mime_type ?? 'application/octet-stream';
    const url = upload.attributes.url ?? '';
    const thumbnailUrl = getThumbnailUrl(mimeType, url, upload.attributes.mux_playback_id);

    const assetMention: AssetMention = {
      type: 'asset',
      id: upload.id,
      filename: upload.attributes.filename,
      url,
      thumbnailUrl,
      mimeType,
    };

    // Insert the mention at cursor position
    const { newText, newCursorPosition } = insertToolbarMention(
      composerValue,
      cursorPosition,
      assetMention
    );

    // Update state
    const newMap = new Map(composerMentionsMap);
    newMap.set(`asset:${upload.id}`, assetMention);
    setComposerMentionsMap(newMap);
    setComposerValue(newText);

    // Focus textarea and update cursor
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
        setCursorPosition(newCursorPosition);
      }
    }, 0);
  }, [ctx, composerValue, cursorPosition, composerMentionsMap, setCursorPosition]);

  const handleModelToolbarClick = createToolbarTriggerHandler('$');

  const handleNavigateToModel = useCallback(
    async (modelId: string, isBlockModel: boolean) => {
      const path = isBlockModel
        ? `/schema/blocks_library/${modelId}`
        : `/schema/item_types/${modelId}`;
      await ctx.navigateTo(path);
    },
    [ctx]
  );

  const handleOpenAsset = useCallback(
    async (assetId: string) => {
      await ctx.editUpload(assetId);
    },
    [ctx]
  );

  const handleOpenRecord = useCallback(
    async (recordId: string, _modelId: string) => {
      await ctx.editItem(recordId);
    },
    [ctx]
  );

  if (status === 'connecting') {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </Canvas>
    );
  }

  if (error) {
    return (
      <Canvas ctx={ctx}>
        <div className={styles.error}>
          <p>Error loading comments</p>
          <span>{error.message}</span>
        </div>
      </Canvas>
    );
  }

  const hasComments = comments.length > 0;

  return (
    <Canvas ctx={ctx}>
      <div className={styles.container}>
      {!cdaToken && (
        <div className={styles.warning}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" role="img" aria-labelledby="warningIconTitle">
            <title id="warningIconTitle">Warning</title>
            <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
          </svg>
          <span>Realtime updates disabled. Configure a CDA token in plugin settings.</span>
        </div>
      )}
      
      {/* Composer - type directly to add a comment */}
      <div className={styles.composer}>
        <div className={styles.composerInputWrapper}>
          <Textarea
            ref={textareaRef}
            className={styles.composerInput}
            value={composerValue}
            onChange={handleMentionChange}
            onKeyDown={handleComposerKeyDown}
            onClick={(e) => setCursorPosition(e.currentTarget.selectionStart)}
            onSelect={(e) => setCursorPosition(e.currentTarget.selectionStart)}
            placeholder={"Add a comment...\n@ user, # field, & record, ^ asset, $ model"}
            minRows={1}
          />
          {activeDropdown === 'field' && (
            <FieldMentionDropdown
              fields={filteredFields}
              query=""
              selectedIndex={selectedIndex}
              onSelect={handleSelectField}
              onClose={closeDropdown}
              pendingFieldForLocale={pendingFieldForLocale}
              onClearPendingField={clearPendingFieldForLocale}
            />
          )}
          {activeDropdown === 'user' && (
            <UserMentionDropdown
              users={filteredUsers}
              query=""
              selectedIndex={selectedIndex}
              onSelect={handleSelectUser}
              onClose={closeDropdown}
            />
          )}
          {activeDropdown === 'model' && (
            <ModelMentionDropdown
              models={filteredModels}
              query=""
              selectedIndex={selectedIndex}
              onSelect={handleSelectModel}
              onClose={closeDropdown}
            />
          )}
          {(isRecordModelSelectorOpen || activeDropdown === 'record') && (
            <RecordModelSelectorDropdown
              models={projectModels}
              onSelect={handleRecordModelSelect}
              onClose={handleRecordModelSelectorClose}
            />
          )}
          
          {/* Slack-style Toolbar */}
          <div className={styles.composerToolbar}>
            <div className={styles.toolbarMentions}>
              {/* User mention */}
              <span className={styles.toolbarButtonWrapper}>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${styles.toolbarButtonUser}`}
                  onClick={handleUserToolbarClick}
                  aria-label="Mention user"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <title>User</title>
                    <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4Zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10Z"/>
                  </svg>
                </button>
                <span className={styles.toolbarTooltip}>
                  User
                  <span className={styles.toolbarTooltipArrow} />
                </span>
              </span>
              {/* Field mention */}
              <span className={styles.toolbarButtonWrapper}>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${styles.toolbarButtonField}`}
                  onClick={handleFieldToolbarClick}
                  aria-label="Mention field"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <title>Field</title>
                    <path d="M8.39 12.648a1.32 1.32 0 0 0-.015.18c0 .305.21.508.5.508.266 0 .492-.172.555-.477l.554-2.703h1.204c.421 0 .617-.234.617-.547 0-.312-.188-.53-.617-.53h-.985l.516-2.524h1.265c.43 0 .618-.227.618-.547 0-.313-.188-.524-.618-.524h-1.046l.476-2.304a1.06 1.06 0 0 0 .016-.164.51.51 0 0 0-.516-.516.54.54 0 0 0-.539.43l-.523 2.554H7.617l.477-2.304c.008-.04.015-.118.015-.164a.512.512 0 0 0-.523-.516.539.539 0 0 0-.531.43L6.53 5.484H5.414c-.43 0-.617.22-.617.532 0 .312.187.539.617.539h.906l-.515 2.523H4.609c-.421 0-.609.219-.609.531 0 .313.188.547.61.547h.976l-.516 2.492c-.008.04-.015.125-.015.18 0 .305.21.508.5.508.265 0 .492-.172.554-.477l.555-2.703h2.242l-.515 2.492Zm-1-6.109h2.266l-.515 2.563H6.859l.532-2.563Z"/>
                  </svg>
                </button>
                <span className={styles.toolbarTooltip}>
                  Field
                  <span className={styles.toolbarTooltipArrow} />
                </span>
              </span>
              {/* Record mention */}
              <span className={styles.toolbarButtonWrapper}>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${styles.toolbarButtonRecord}`}
                  onClick={handleRecordClick}
                  aria-label="Mention record"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <title>Record</title>
                    <path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/>
                    <path d="M3 4h10v1H3V4zm0 3h10v1H3V7zm0 3h6v1H3v-1z"/>
                  </svg>
                </button>
                <span className={styles.toolbarTooltip}>
                  Record
                  <span className={styles.toolbarTooltipArrow} />
                </span>
              </span>
              {/* Asset mention */}
              <span className={styles.toolbarButtonWrapper}>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${styles.toolbarButtonAsset}`}
                  onClick={handleAssetClick}
                  aria-label="Mention asset"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <title>Asset</title>
                    <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
                    <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-12zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h12z"/>
                  </svg>
                </button>
                <span className={styles.toolbarTooltip}>
                  Asset
                  <span className={styles.toolbarTooltipArrow} />
                </span>
              </span>
              {/* Model mention */}
              <span className={styles.toolbarButtonWrapper}>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${styles.toolbarButtonModel}`}
                  onClick={handleModelToolbarClick}
                  aria-label="Mention model"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <title>Model</title>
                    <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z"/>
                  </svg>
                </button>
                <span className={styles.toolbarTooltip}>
                  Model
                  <span className={styles.toolbarTooltipArrow} />
                </span>
              </span>
            </div>
            <span className={styles.toolbarButtonWrapper}>
              <button
                type="button"
                className={styles.sendButton}
                onClick={submitNewComment}
                disabled={!composerValue.trim()}
                aria-label="Send comment"
              >
                <svg viewBox="0 0 16 16" fill="currentColor">
                  <title>Send</title>
                  <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083l6-15Zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471-.47 1.178Z"/>
                </svg>
              </button>
              <span className={styles.toolbarTooltip}>
                Send
                <span className={styles.toolbarTooltipArrow} />
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Comments list */}
      {hasComments ? (
        <div className={styles.commentsList}>
          {comments.map((comment) => (
            <Comment
              key={comment.dateISO}
              deleteComment={deleteComment}
              editComment={editComment}
              upvoteComment={upvoteComment}
              replyComment={replyComment}
              commentObject={comment}
              currentUserEmail={userEmail}
              modelFields={modelFields}
              projectUsers={projectUsers}
              projectModels={projectModels}
              onScrollToField={handleScrollToField}
              onNavigateToUsers={handleNavigateToUsers}
              onNavigateToModel={handleNavigateToModel}
              onOpenAsset={handleOpenAsset}
              onOpenRecord={handleOpenRecord}
            />
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <p>No comments yet</p>
          <span>Be the first to leave a comment on this record.</span>
        </div>
      )}
      </div>
    </Canvas>
  );
};

export default CommentsBar;
