import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import RecordModelSelectorDropdown from '../recordComments/entrypoints/components/RecordModelSelectorDropdown';
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
import commentBarStyles from '../recordComments/entrypoints/styles/commentbar.module.css';
import styles from './MentionComposer.module.css';

type MentionComposerProps = {
  host: AgentMentionHost;
  navigation: NavigationCallbacks;
  disabled: boolean;
  isRunning: boolean;
  placeholder: string;
  persistenceWarning?: string;
  onSubmit: (submission: AgentComposerSubmission) => void;
  onStop?: () => void;
};

function mentionCount(segments: readonly CommentSegment[]) {
  return segments.filter((segment) => segment.type === 'mention').length;
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
  files: FileList,
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

export function MentionComposer({
  host,
  navigation,
  disabled,
  isRunning,
  placeholder,
  persistenceWarning,
  onSubmit,
  onStop,
}: MentionComposerProps) {
  const composerRef = useRef<TipTapComposerRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [segments, setSegments] = useState<CommentSegment[]>([]);
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
  const [pickerError, setPickerError] = useState<string>();
  const [isRecordModelSelectorOpen, setRecordModelSelectorOpen] =
    useState(false);

  const providerText = useMemo(
    () => segmentsProviderText(segments),
    [segments],
  );
  const tooManyMentions = mentionCount(segments) > MAX_MENTIONS_PER_MESSAGE;
  const tooLong = providerText.length > MAX_CONVERSATION_MESSAGE_CHARACTERS;
  const empty = !segmentsDisplayText(segments);
  const inputDisabled = disabled || isRunning;
  const inputDisabledRef = useRef(inputDisabled);
  const usersRequestRef = useRef<Promise<void> | null>(null);
  const fieldsRequestRef = useRef<Promise<void> | null>(null);
  inputDisabledRef.current = inputDisabled;
  const canSubmit = !inputDisabled && !empty && !tooLong && !tooManyMentions;

  useEffect(() => {
    if (inputDisabled) setRecordModelSelectorOpen(false);
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
    setPickerError(undefined);
  }, [inputDisabled, onSubmit, segments]);

  const selectAsset = useCallback(async () => {
    if (inputDisabledRef.current) return;
    setPickerError(undefined);
    try {
      const mention = await host.selectAsset();
      if (inputDisabledRef.current) return;
      if (mention) composerRef.current?.insertMention(mention);
      else composerRef.current?.focus();
    } catch {
      if (!inputDisabledRef.current) {
        setPickerError('The asset picker could not be opened.');
      }
    }
  }, [host]);

  const selectLocalFiles = useCallback(
    (files: FileList | null) => {
      if (inputDisabledRef.current || !files?.length) return;

      setPickerError(undefined);
      const currentSegments = composerRef.current?.getSegments() ?? segments;
      const { acceptedFiles, error } = selectAllowedLocalFiles(
        files,
        currentSegments,
      );
      composerRef.current?.insertMentions(acceptedFiles.map(registerLocalFile));
      if (error) setPickerError(error);
      composerRef.current?.focus();
    },
    [segments],
  );

  const selectRecord = useCallback(
    async (model: AgentMentionHost['recordModels'][number]) => {
      if (inputDisabledRef.current || !model) return;
      setRecordModelSelectorOpen(false);
      setPickerError(undefined);
      try {
        const mention = await host.selectRecord(model);
        if (inputDisabledRef.current) return;
        if (mention) composerRef.current?.insertMention(mention);
        else composerRef.current?.focus();
      } catch {
        if (!inputDisabledRef.current) {
          setPickerError('The record picker could not be opened.');
        }
      }
    },
    [host],
  );

  return (
    <ProjectDataProvider
      currentUserId={host.currentUser.id}
      modelFields={modelFields}
      projectModels={host.projectModels}
      projectUsers={projectUsers}
    >
      <NavigationCallbacksProvider callbacks={navigation}>
        <div className={commentBarStyles.composerInputWrapper}>
          <input
            aria-label="Choose files from computer"
            disabled={inputDisabled}
            hidden
            multiple
            onChange={(event) => {
              selectLocalFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
            ref={fileInputRef}
            type="file"
          />

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
              if (!inputDisabledRef.current) setRecordModelSelectorOpen(true);
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

          {isRecordModelSelectorOpen && !inputDisabled && (
            <RecordModelSelectorDropdown
              models={host.recordModels}
              onClose={() => {
                setRecordModelSelectorOpen(false);
                composerRef.current?.focus();
              }}
              onSelect={(model) => {
                void selectRecord(model);
              }}
              position="above"
            />
          )}

          <ComposerToolbar
            canMentionAssets={host.canMentionAssets}
            canMentionFields={host.canMentionFields}
            canMentionModels={host.canMentionModels}
            disabled={inputDisabled}
            isRunning={isRunning}
            isSendDisabled={!canSubmit}
            onAssetClick={() => {
              void selectAsset();
            }}
            onFieldClick={() =>
              composerRef.current?.triggerMentionType('field')
            }
            onFileClick={() => fileInputRef.current?.click()}
            onModelClick={() =>
              composerRef.current?.triggerMentionType('model')
            }
            onRecordClick={() => setRecordModelSelectorOpen(true)}
            onSendClick={submit}
            onStopClick={onStop}
            onUserClick={() => composerRef.current?.triggerMentionType('user')}
          />
        </div>

        <div aria-live="polite" className={styles.messages}>
          {tooManyMentions && (
            <p role="alert">
              Use no more than {MAX_MENTIONS_PER_MESSAGE} references.
            </p>
          )}
          {tooLong && (
            <p role="alert">
              This message is too long. Remove some text or references.
            </p>
          )}
          {usersError && <p role="alert">{usersError}</p>}
          {pickerError && <p role="alert">{pickerError}</p>}
          {persistenceWarning && <p role="alert">{persistenceWarning}</p>}
        </div>
      </NavigationCallbacksProvider>
    </ProjectDataProvider>
  );
}
