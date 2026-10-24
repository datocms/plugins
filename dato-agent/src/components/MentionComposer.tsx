import Button from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import { dropTargetClassName, useFilePicker } from 'datocms-react-ui/dnd';
import { useEditorToolbarWiring } from 'datocms-react-ui/EditorToolbar';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import NewZIndex from 'datocms-react-ui/NewZIndex';
import Portal from 'datocms-react-ui/Portal';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SendIcon, StopIcon } from '../icons';
import { MAX_CONVERSATION_MESSAGE_CHARACTERS } from '../lib/conversations';
import {
  localFileDescriptorFromMention,
  localFileMaximumBytes,
  MAX_LOCAL_FILES_PER_MESSAGE,
  MAX_LOCAL_FILES_TOTAL_BYTES,
  registerLocalFile,
} from '../lib/localFiles';
import type { AgentMentionHost } from '../lib/mentionHost';
import {
  type AgentComposerSubmission,
  type CommentSegment,
  MAX_MENTIONS_PER_MESSAGE,
  segmentsDisplayText,
  segmentsProviderText,
} from '../lib/mentions';
import ComposerToolbar from '../recordComments/entrypoints/components/ComposerToolbar';
import { RecordModelPanel } from '../recordComments/entrypoints/components/RecordModelSelectorDropdown';
import {
  TipTapComposer,
  type TipTapComposerRef,
} from '../recordComments/entrypoints/components/tiptap/TipTapComposer';
import type { NavigationCallbacks } from '../recordComments/entrypoints/contexts/NavigationCallbacksContext';
import { NavigationCallbacksProvider } from '../recordComments/entrypoints/contexts/NavigationCallbacksContext';
import { ProjectDataProvider } from '../recordComments/entrypoints/contexts/ProjectDataContext';
import type {
  FieldInfo,
  UserInfo,
} from '../recordComments/entrypoints/hooks/useMentions';
import styles from './MentionComposer.module.css';

type MentionComposerProps = {
  host: AgentMentionHost;
  navigation: NavigationCallbacks;
  currentRecordId?: string;
  disabled: boolean;
  /** Why the composer is off, for the tooltip of Send */
  disabledReason?: string;
  isRunning: boolean;
  placeholder: string;
  onSubmit: (submission: AgentComposerSubmission) => void;
  onStop?: () => void;
};

function mentionCount(segments: readonly CommentSegment[]) {
  return segments.filter((segment) => segment.type === 'mention').length;
}

function dragIncludesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

const LOCAL_FILE_REJECTION_MESSAGES = {
  empty: 'Empty files cannot be attached.',
  oversized:
    'Images must be 10 MB or smaller; other files must be 20 MB or smaller.',
  count: `A message can include up to ${MAX_LOCAL_FILES_PER_MESSAGE} files and ${MAX_MENTIONS_PER_MESSAGE} total references.`,
  totalSize: 'Files in one message cannot exceed 25 MB total.',
} as const;

type LocalFileRejection = keyof typeof LOCAL_FILE_REJECTION_MESSAGES;

function localFileRejection(
  file: File,
  acceptedCount: number,
  availableSlots: number,
  availableBytes: number,
): LocalFileRejection | undefined {
  if (file.size === 0) return 'empty';
  if (file.size > localFileMaximumBytes(file.type)) return 'oversized';
  if (acceptedCount >= availableSlots) return 'count';
  if (file.size > availableBytes) return 'totalSize';
  return undefined;
}

function selectAllowedLocalFiles(
  files: readonly File[],
  segments: readonly CommentSegment[],
): { acceptedFiles: File[]; error?: string } {
  const currentFiles = segments.flatMap((segment) =>
    segment.type === 'mention' && segment.mention.type === 'file'
      ? [segment.mention]
      : [],
  );
  const availableSlots = Math.min(
    Math.max(0, MAX_MENTIONS_PER_MESSAGE - mentionCount(segments)),
    Math.max(0, MAX_LOCAL_FILES_PER_MESSAGE - currentFiles.length),
  );
  let availableBytes = Math.max(
    0,
    MAX_LOCAL_FILES_TOTAL_BYTES -
      currentFiles.reduce((total, file) => total + file.size, 0),
  );
  const acceptedFiles: File[] = [];
  const rejections = new Set<LocalFileRejection>();

  for (const file of files) {
    const rejection = localFileRejection(
      file,
      acceptedFiles.length,
      availableSlots,
      availableBytes,
    );
    if (rejection) {
      rejections.add(rejection);
      continue;
    }
    acceptedFiles.push(file);
    availableBytes -= file.size;
  }

  const error = Object.entries(LOCAL_FILE_REJECTION_MESSAGES)
    .flatMap(([key, message]) =>
      rejections.has(key as LocalFileRejection) ? [message] : [],
    )
    .join(' ');
  return { acceptedFiles, ...(error ? { error } : {}) };
}

const TOO_MANY_MENTIONS_MESSAGE = `Use no more than ${MAX_MENTIONS_PER_MESSAGE} references.`;
const TOO_LONG_MESSAGE =
  'This message is too long. Remove some text or references.';

/** The error of the message, under the composer, or undefined */
function messageError(tooManyMentions: boolean, tooLong: boolean) {
  const errors = [
    ...(tooManyMentions ? [TOO_MANY_MENTIONS_MESSAGE] : []),
    ...(tooLong ? [TOO_LONG_MESSAGE] : []),
  ];
  return errors.length > 0 ? errors.join(' ') : undefined;
}

// The drop cue covers the whole frame: a file dropped anywhere is attached.
// Inline, because the kit's drop target class sets `position: relative`.
const DROP_LAYER_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  pointerEvents: 'none',
};

export function MentionComposer({
  host,
  navigation,
  currentRecordId,
  disabled,
  disabledReason,
  isRunning,
  placeholder,
  onSubmit,
  onStop,
}: MentionComposerProps) {
  const ctx = useCtx();
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const composerRef = useRef<TipTapComposerRef>(null);
  const fileDragDepthRef = useRef(0);
  const [segments, setSegments] = useState<CommentSegment[]>([]);
  const segmentsRef = useRef(segments);
  const [isDraggingFiles, setDraggingFiles] = useState(false);
  const [projectUsers, setProjectUsers] = useState<UserInfo[]>([
    host.currentUser,
  ]);
  const [modelFields, setModelFields] = useState<FieldInfo[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [fieldsLoaded, setFieldsLoaded] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [usersError, setUsersError] = useState<string>();
  const [fieldsError, setFieldsError] = useState<string>();
  // The panel of the record models that the "/" command opens
  const [recordPanelOpen, setRecordPanelOpen] = useState(false);
  // The record dropdown of the insert toolbar is open
  const [recordMenuOpen, setRecordMenuOpen] = useState(false);
  // An asset or record picker of the host is open
  const [pickerOpen, setPickerOpen] = useState(false);

  const providerText = useMemo(
    () => segmentsProviderText(segments),
    [segments],
  );
  const tooManyMentions = mentionCount(segments) > MAX_MENTIONS_PER_MESSAGE;
  const tooLong = providerText.length > MAX_CONVERSATION_MESSAGE_CHARACTERS;
  const fieldError = messageError(tooManyMentions, tooLong);
  const empty = !segmentsDisplayText(segments);
  const inputDisabled = disabled || isRunning;
  const inputDisabledRef = useRef(inputDisabled);
  const usersRequestRef = useRef<Promise<void> | null>(null);
  const fieldsRequestRef = useRef<Promise<void> | null>(null);
  inputDisabledRef.current = inputDisabled;
  segmentsRef.current = segments;

  // The insert toolbar shows while the editor has the focus, while the
  // record dropdown of the toolbar or the panel of the record models is open,
  // or while a picker of the host is open (the editor gets the focus back
  // when it closes)
  const focusEditor = useCallback(() => composerRef.current?.focus(), []);
  const {
    setFocused: setEditorFocused,
    onMenuToggle: setToolbarMenuOpen,
    visible: toolbarVisible,
  } = useEditorToolbarWiring({ busy: pickerOpen, focusEditor });

  useEffect(() => {
    setToolbarMenuOpen((recordPanelOpen || recordMenuOpen) && !inputDisabled);
  }, [inputDisabled, recordMenuOpen, recordPanelOpen, setToolbarMenuOpen]);

  // The record dropdown is another reference type: when it opens, the
  // pending "/" command and the panel of the command close
  const handleRecordMenuToggle = useCallback((open: boolean) => {
    setRecordMenuOpen(open);
    if (!open) return;
    setRecordPanelOpen(false);
    composerRef.current?.discardPendingMentionCommand();
  }, []);

  // Picker failures and refused files are toasts of the host
  const reportError = useCallback((message: string) => {
    void ctxRef.current.alert(message);
  }, []);

  useEffect(() => {
    if (inputDisabled) {
      fileDragDepthRef.current = 0;
      setDraggingFiles(false);
      // The record panel closes with the composer
      setRecordPanelOpen(false);
    }
  }, [inputDisabled]);

  const loadUsers = useCallback(
    (force = false) => {
      if ((!force && usersLoaded) || usersRequestRef.current) {
        return usersRequestRef.current ?? Promise.resolve();
      }

      setUsersError(undefined);
      setUsersLoading(true);
      const request = host
        .loadProjectUsers()
        .then((users) => {
          setProjectUsers(users);
          setUsersLoaded(true);
        })
        .catch((error: unknown) => {
          setUsersError(
            error instanceof Error
              ? error.message
              : 'Users could not be loaded.',
          );
        })
        .finally(() => {
          if (usersRequestRef.current === request) {
            usersRequestRef.current = null;
            setUsersLoading(false);
          }
        });
      usersRequestRef.current = request;
      return request;
    },
    [host, usersLoaded],
  );

  const loadFields = useCallback(
    (force = false) => {
      if (!host.loadModelFields) return Promise.resolve();
      if ((!force && fieldsLoaded) || fieldsRequestRef.current) {
        return fieldsRequestRef.current ?? Promise.resolve();
      }

      setFieldsError(undefined);
      setFieldsLoading(true);
      const request = host
        .loadModelFields()
        .then((fields) => {
          setModelFields(fields);
          setFieldsLoaded(true);
        })
        .catch((error: unknown) => {
          setFieldsError(
            error instanceof Error
              ? error.message
              : 'Fields could not be loaded.',
          );
        })
        .finally(() => {
          if (fieldsRequestRef.current === request) {
            fieldsRequestRef.current = null;
            setFieldsLoading(false);
          }
        });
      fieldsRequestRef.current = request;
      return request;
    },
    [fieldsLoaded, host],
  );

  const submit = useCallback(() => {
    const currentSegments = composerRef.current?.getSegments() ?? segments;
    const displayText = segmentsDisplayText(currentSegments);
    const currentProviderText = segmentsProviderText(currentSegments);
    if (
      !displayText ||
      inputDisabled ||
      mentionCount(currentSegments) > MAX_MENTIONS_PER_MESSAGE ||
      currentProviderText.length > MAX_CONVERSATION_MESSAGE_CHARACTERS
    ) {
      return;
    }

    const attachments = currentSegments.flatMap((segment) =>
      segment.type === 'mention' && segment.mention.type === 'file'
        ? [localFileDescriptorFromMention(segment.mention)]
        : [],
    );

    onSubmit({
      displayText,
      providerText: currentProviderText,
      segments: currentSegments,
      ...(attachments.length > 0 && { attachments }),
    });
    composerRef.current?.clear();
    setSegments([]);
  }, [inputDisabled, onSubmit, segments]);

  const selectAsset = useCallback(async () => {
    if (inputDisabledRef.current) return;
    setPickerOpen(true);
    try {
      const mention = await host.selectAsset();
      if (inputDisabledRef.current) return;
      if (mention) composerRef.current?.insertMention(mention);
      else composerRef.current?.focus();
    } catch {
      if (!inputDisabledRef.current) {
        reportError('The asset picker could not be opened.');
      }
    } finally {
      setPickerOpen(false);
    }
  }, [host, reportError]);

  const selectLocalFiles = useCallback(
    (files: readonly File[]) => {
      if (inputDisabledRef.current || files.length === 0) return;

      const currentSegments =
        composerRef.current?.getSegments() ?? segmentsRef.current;
      const { acceptedFiles, error } = selectAllowedLocalFiles(
        files,
        currentSegments,
      );
      composerRef.current?.insertMentions(acceptedFiles.map(registerLocalFile));
      if (error) reportError(error);
      composerRef.current?.focus();
    },
    [reportError],
  );

  const filePicker = useFilePicker({ onPick: selectLocalFiles });

  // The listeners are on the window, in the capture phase: a file dropped
  // anywhere in the frame is attached, and a file dropped while the
  // composer is disabled never opens in the frame.
  useEffect(() => {
    const resetFileDrag = () => {
      fileDragDepthRef.current = 0;
      setDraggingFiles(false);
    };

    const handleDragEnter = (event: DragEvent) => {
      if (!dragIncludesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (inputDisabledRef.current) return;
      fileDragDepthRef.current += 1;
      setDraggingFiles(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!dragIncludesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = inputDisabledRef.current
          ? 'none'
          : 'copy';
      }
    };

    const handleDragLeave = (event: DragEvent) => {
      if (fileDragDepthRef.current === 0) return;
      event.preventDefault();
      event.stopPropagation();
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) setDraggingFiles(false);
    };

    const handleDrop = (event: DragEvent) => {
      if (!dragIncludesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const files = Array.from(event.dataTransfer?.files ?? []);
      resetFileDrag();
      if (!inputDisabledRef.current) selectLocalFiles(files);
    };

    window.addEventListener('dragenter', handleDragEnter, true);
    window.addEventListener('dragover', handleDragOver, true);
    window.addEventListener('dragleave', handleDragLeave, true);
    window.addEventListener('dragend', resetFileDrag, true);
    window.addEventListener('drop', handleDrop, true);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter, true);
      window.removeEventListener('dragover', handleDragOver, true);
      window.removeEventListener('dragleave', handleDragLeave, true);
      window.removeEventListener('dragend', resetFileDrag, true);
      window.removeEventListener('drop', handleDrop, true);
    };
  }, [selectLocalFiles]);

  const selectRecord = useCallback(
    async (model: AgentMentionHost['recordModels'][number]) => {
      if (inputDisabledRef.current || !model) return;
      setRecordPanelOpen(false);
      setPickerOpen(true);
      try {
        const mention = await host.selectRecord(model);
        if (inputDisabledRef.current) return;
        if (mention) composerRef.current?.insertMention(mention);
        else composerRef.current?.focus();
      } catch {
        if (!inputDisabledRef.current) {
          reportError('The record picker could not be opened.');
        }
      } finally {
        setPickerOpen(false);
      }
    },
    [host, reportError],
  );

  return (
    <ProjectDataProvider
      currentUserId={host.currentUser.id}
      currentRecordId={currentRecordId}
      modelFields={modelFields}
      projectModels={host.projectModels}
      projectUsers={projectUsers}
    >
      <NavigationCallbacksProvider callbacks={navigation}>
        <FieldWrapper
          label="Message"
          labelExtras={{ hidden: true }}
          error={fieldError}
        >
          {/* The box of the field: the insert toolbar, the editor and the
              send button. The menus open above it. */}
          <div className={styles.box}>
            {filePicker.input}

            <div className={styles.toolbar}>
              <ComposerToolbar
                canMentionAssets={host.canMentionAssets}
                canMentionFields={host.canMentionFields}
                canMentionModels={host.canMentionModels}
                disabled={inputDisabled}
                hidden={!toolbarVisible}
                onAssetClick={() => {
                  setRecordPanelOpen(false);
                  composerRef.current?.discardPendingMentionCommand();
                  void selectAsset();
                }}
                onFieldClick={() => {
                  setRecordPanelOpen(false);
                  composerRef.current?.triggerMentionType('field');
                }}
                onFileClick={() => {
                  if (!inputDisabledRef.current) filePicker.open();
                }}
                onModelClick={() => {
                  setRecordPanelOpen(false);
                  composerRef.current?.triggerMentionType('model');
                }}
                onRecordMenuToggle={handleRecordMenuToggle}
                onRecordModelSelect={(model) => {
                  void selectRecord(model);
                }}
                onUserClick={() => {
                  setRecordPanelOpen(false);
                  composerRef.current?.triggerMentionType('user');
                }}
                recordModels={host.recordModels}
              />
            </div>

            {/* The focus of the editor, or of a control of its menus */}
            <div
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setEditorFocused(false);
                }
              }}
              onFocus={() => setEditorFocused(true)}
            >
              <TipTapComposer
                ariaLabel="Message the DatoCMS agent"
                autoFocus={false}
                canMentionAssets={host.canMentionAssets}
                canMentionFields={host.canMentionFields}
                canMentionModels={host.canMentionModels}
                disabled={inputDisabled}
                dropdownPosition="above"
                fieldMentionsError={fieldsError ?? null}
                fieldMentionsLoading={fieldsLoading}
                maxLength={MAX_CONVERSATION_MESSAGE_CHARACTERS}
                modelFields={modelFields}
                onAssetTrigger={() => {
                  void selectAsset();
                }}
                onFieldMentionIntent={() => {
                  void loadFields();
                }}
                onFieldMentionsRetry={() => {
                  void loadFields(true);
                }}
                onRecordTrigger={() => {
                  if (!inputDisabledRef.current) setRecordPanelOpen(true);
                }}
                onSegmentsChange={setSegments}
                onSubmit={submit}
                onUserMentionIntent={() => {
                  void loadUsers();
                }}
                onUserMentionsRetry={() => {
                  void loadUsers(true);
                }}
                placeholder={placeholder}
                projectModels={host.projectModels}
                projectUsers={projectUsers}
                userMentionsError={usersError ?? null}
                userMentionsLoading={usersLoading}
                ref={composerRef}
                segments={segments}
              />
            </div>

            {recordPanelOpen && !inputDisabled && (
              <RecordModelPanel
                models={host.recordModels}
                onClose={() => {
                  setRecordPanelOpen(false);
                  composerRef.current?.focus();
                }}
                onLeave={() => setRecordPanelOpen(false)}
                onSelect={(model) => {
                  void selectRecord(model);
                }}
                position="above"
              />
            )}

            {/* Send, or Stop while the agent runs: icon buttons, the size
                of the buttons of the toolbar above. An icon button that
                must stand out is soft, not primary. */}
            <div className={styles.actions}>
              {isRunning ? (
                <Button
                  disabled={
                    onStop ? false : { reason: 'This turn can’t be stopped.' }
                  }
                  icon={StopIcon}
                  iconOnly
                  label="Stop"
                  onClick={() => onStop?.()}
                  size="micro"
                  tone="soft"
                />
              ) : (
                <Button
                  disabled={sendDisabled({
                    inputDisabled,
                    disabledReason,
                    empty,
                    error: fieldError,
                  })}
                  icon={SendIcon}
                  iconOnly
                  label="Send"
                  onClick={submit}
                  size="micro"
                  tone="soft"
                />
              )}
            </div>
          </div>
        </FieldWrapper>

        {isDraggingFiles && !inputDisabled && (
          <Portal>
            <NewZIndex>
              {(zIndex) => (
                <div
                  className={dropTargetClassName({
                    isOver: true,
                    ringOnly: true,
                  })}
                  style={{ ...DROP_LAYER_STYLE, zIndex }}
                >
                  {/* Announced, as the cue of the drop */}
                  <div className="DropTarget__label" role="status">
                    <span>Drop files to attach</span>
                  </div>
                </div>
              )}
            </NewZIndex>
          </Portal>
        )}
      </NavigationCallbacksProvider>
    </ProjectDataProvider>
  );
}

/** Send is off while the composer is off or the message can't go, and says why */
function sendDisabled({
  inputDisabled,
  disabledReason,
  empty,
  error,
}: {
  inputDisabled: boolean;
  disabledReason: string | undefined;
  empty: boolean;
  error: string | undefined;
}): boolean | { reason: string } {
  if (inputDisabled) return disabledReason ? { reason: disabledReason } : true;
  if (empty) return { reason: 'Type a message first.' };
  if (error) return { reason: error };
  return false;
}
