import type { RenderModalCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas, { useCtx } from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import SelectInput from 'datocms-react-ui/SelectInput';
import UserRow, {
  type UserRowEntity,
  userPresentation,
} from 'datocms-react-ui/UserRow';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type BulkProgress,
  bulkChangeCreator,
  type CreatorType,
} from '../actions/bulkChangeCreator';
import { CircleExclamationIcon } from '../icons';
import { describeApiError } from '../services/requestErrors';
import {
  LARGE_SELECTION_THRESHOLD,
  resolveExecutionError,
} from '../utils/bulkCreatorWorkflow';
import styles from './SelectCreatorModal.module.css';

// A module constant: a new texts object on each render would render the whole
// dialog again
const TEXTS = {
  'bulkChangeAuthor.newCreatorHint':
    '{count, plural, =0 {Becomes the creator of the selected records.} one {Becomes the creator of the selected record.} other {Becomes the creator of the # selected records.}}',
} as const;

type Props = {
  ctx: RenderModalCtx;
};

type ModalParameters = {
  preselectedUserId?: string;
  preselectedUserType?: CreatorType;
  itemCount?: number;
  itemIds?: string[];
};

// A collaborator, an SSO user and the owner account can share an id: the
// select's value joins the type and the id, and `id` keeps the bare id. The
// label is what the search of the select matches: the name and the email
type Option = {
  label: string;
  value: string;
  id: string;
  userType: CreatorType;
  user: UserRowEntity;
};

type OptionGroup<T> = {
  label?: string;
  options: T[];
};

type LoadResults = {
  collaboratorsResult: PromiseSettledResult<UserRowEntityWithId[]>;
  ssoUsersResult: PromiseSettledResult<UserRowEntityWithId[]>;
  owner: UserRowEntityWithId | null;
};

type UserRowEntityWithId = UserRowEntity & { id: string };

function buildOptionsFromLoadResults({
  collaboratorsResult,
  ssoUsersResult,
  owner,
}: LoadResults): {
  nextOptionGroups: OptionGroup<Option>[];
  allOptions: Option[];
  firstRejectionReason: unknown | null;
} {
  const collaboratorOptions =
    collaboratorsResult.status === 'fulfilled'
      ? collaboratorsResult.value.map((user) => toOption(user, 'user'))
      : [];
  const ssoOptions =
    ssoUsersResult.status === 'fulfilled'
      ? ssoUsersResult.value.map((user) => toOption(user, 'sso_user'))
      : [];
  const ownerOption = owner ? toOwnerOption(owner) : null;

  const nextOptionGroups = buildOptionGroups(
    collaboratorOptions,
    ssoOptions,
    ownerOption,
  );
  const allOptions = flattenOptionGroups(nextOptionGroups);

  const rejectedResults = [collaboratorsResult, ssoUsersResult].filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  const firstRejectionReason =
    rejectedResults.length > 0 ? rejectedResults[0].reason : null;

  return { nextOptionGroups, allOptions, firstRejectionReason };
}

function findPreselectedOption(
  allOptions: Option[],
  preselectedUserId?: string,
  preselectedUserType?: CreatorType,
): Option | null {
  if (!preselectedUserId) {
    return null;
  }

  const match = allOptions.find((option) => {
    const matchesId = option.id === preselectedUserId;
    if (!matchesId) {
      return false;
    }
    if (!preselectedUserType) {
      return true;
    }
    return option.userType === preselectedUserType;
  });

  return match ?? null;
}

function resolveLoadedSelection(
  allOptions: Option[],
  current: Option | null,
  preselectedUserId?: string,
  preselectedUserType?: CreatorType,
) {
  if (preselectedUserId) {
    return findPreselectedOption(
      allOptions,
      preselectedUserId,
      preselectedUserType,
    );
  }
  return allOptions.length === 0 ? null : current;
}

type FetchUserOptionsResult = {
  nextOptionGroups: OptionGroup<Option>[];
  allOptions: Option[];
  firstRejectionReason: unknown | null;
};

// The people come from the host: the collaborators and the SSO users through
// its loaders, the owner of the project from ctx
async function fetchUserOptions(
  ctx: RenderModalCtx,
): Promise<FetchUserOptionsResult> {
  const [collaboratorsResult, ssoUsersResult] = await Promise.allSettled([
    ctx.loadUsers(),
    ctx.loadSsoUsers(),
  ]);

  return buildOptionsFromLoadResults({
    collaboratorsResult,
    ssoUsersResult,
    owner: ctx.owner ?? null,
  });
}

/** A short summary of a failed load: the HTTP status, else the message */
function describeLoadError(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    error.response
  ) {
    return describeApiError(error);
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return describeApiError(error);
}

// The menu shows each person as a row (avatar, name, email); the control
// shows the chosen one on one line
function formatOptionLabel(
  option: Option,
  { context }: { context: 'menu' | 'value' },
) {
  return context === 'menu' ? (
    <UserRow layout="row" user={option.user} />
  ) : (
    <UserRow layout="inline" user={option.user} />
  );
}

function ExecutionProgress({ progress }: { progress: BulkProgress }) {
  const { ui } = useCtx<RenderModalCtx>();
  const { format } = new Intl.NumberFormat(ui.locale);

  return (
    <div
      className={styles.progress}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <p>
        {progress.stopping ? 'Stopping…' : 'Changing creators…'}{' '}
        {format(progress.processed)} of {format(progress.total)} records
        processed.
      </p>
      <ProgressBar
        value={progress.total > 0 ? progress.processed / progress.total : 0}
        ariaLabel="Changing creators"
      />
      <p className={styles.subtle}>
        {format(progress.succeeded)} changed, {format(progress.active)} in
        progress.
        {progress.failed > 0 && ` ${format(progress.failed)} failed.`}
      </p>
      {progress.stopping && (
        <p className={styles.subtle}>
          Waiting for requests already started to finish. No further records
          will be started.
        </p>
      )}
    </div>
  );
}

export default function SelectCreatorModal({ ctx }: Props) {
  const params = useMemo<ModalParameters>(() => {
    return (ctx.parameters as ModalParameters) ?? {};
  }, [ctx.parameters]);

  const itemIds = Array.isArray(params.itemIds) ? params.itemIds : undefined;
  const itemCount = itemIds?.length ?? params.itemCount ?? 0;
  const isContinuousExecution = Boolean(
    itemIds && itemIds.length >= LARGE_SELECTION_THRESHOLD,
  );
  const [optionGroups, setOptionGroups] = useState<OptionGroup<Option>[]>([]);
  const [selectedUser, setSelectedUser] = useState<Option | null>(null);
  // With a token the creators load on mount: start in the loading state, so
  // the first frame doesn't say that there are no creators
  const [isLoading, setIsLoading] = useState<boolean>(
    Boolean(ctx.currentUserAccessToken),
  );
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [partialListWarning, setPartialListWarning] = useState<string | null>(
    null,
  );
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const executionStarted = useRef(false);
  const abortController = useRef<AbortController | null>(null);
  const hasOptions = optionGroups.some((group) => group.options.length > 0);

  // The loaders of the host, read when the people load: a new ctx on each
  // host update must not load them again
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    let cancelled = false;

    async function applyFetchedUsers() {
      const { nextOptionGroups, allOptions, firstRejectionReason } =
        await fetchUserOptions(ctxRef.current);

      if (cancelled) {
        return;
      }

      setOptionGroups(nextOptionGroups);

      setSelectedUser((current) =>
        resolveLoadedSelection(
          allOptions,
          current,
          params.preselectedUserId,
          params.preselectedUserType,
        ),
      );

      if (firstRejectionReason === null) {
        return;
      }
      if (allOptions.length === 0) {
        setFetchError(describeLoadError(firstRejectionReason));
      } else {
        setPartialListWarning(describeLoadError(firstRejectionReason));
      }
    }

    async function loadUsers() {
      if (!ctx.currentUserAccessToken) {
        setFetchError(
          'The plugin has no access to your API token (currentUserAccessToken permission).',
        );
        setOptionGroups([]);
        setSelectedUser(null);
        return;
      }

      setIsLoading(true);
      setFetchError(null);
      setPartialListWarning(null);

      try {
        await applyFetchedUsers();
      } catch (error) {
        if (cancelled) {
          return;
        }

        setFetchError(describeLoadError(error));
        setOptionGroups([]);
        setSelectedUser(null);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadUsers();

    return () => {
      cancelled = true;
    };
  }, [
    ctx.currentUserAccessToken,
    params.preselectedUserId,
    params.preselectedUserType,
  ]);

  useEffect(() => {
    return () => {
      abortController.current?.abort();
    };
  }, []);

  const handleSelectChange = (option: Option | null) => {
    if (executionStarted.current) {
      return;
    }
    setSelectedUser(option ?? null);
    setSelectionError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (executionStarted.current) {
      return;
    }
    if (!selectedUser) {
      setSelectionError(
        'Select a collaborator, SSO user, or project owner to continue.',
      );
      return;
    }
    if (!isContinuousExecution || !itemIds) {
      executionStarted.current = true;
      ctx.resolve({
        userId: selectedUser.id,
        userType: selectedUser.userType,
      });
      return;
    }

    if (!ctx.currentUserAccessToken) {
      setSelectionError(
        'The access token required to change creators is unavailable.',
      );
      return;
    }

    executionStarted.current = true;
    const controller = new AbortController();
    abortController.current = controller;
    setIsRunning(true);
    setProgress({
      total: itemIds.length,
      succeeded: 0,
      failed: 0,
      processed: 0,
      active: 0,
      stopping: false,
    });

    try {
      const bulkResult = await bulkChangeCreator({
        apiToken: ctx.currentUserAccessToken,
        environment: ctx.environment,
        baseUrl: ctx.cmaBaseUrl,
        itemIds,
        userId: selectedUser.id,
        userType: selectedUser.userType,
        signal: controller.signal,
        onProgress: setProgress,
      });
      ctx.resolve({ bulkResult });
    } catch (error) {
      ctx.resolve({
        executionError: `The creator change stopped unexpectedly and its final outcome could not be confirmed. Check the selected records before running the action again. ${resolveExecutionError(error)}`,
      });
    }
  };

  const handleCancel = () => {
    if (executionStarted.current) {
      return;
    }
    executionStarted.current = true;
    ctx.resolve(null);
  };

  const handleStop = () => {
    abortController.current?.abort();
    setProgress((current) => current && { ...current, stopping: true });
  };

  const cancel = <Button tone="ghost" label="Cancel" onClick={handleCancel} />;

  if (fetchError) {
    return (
      <Canvas ctx={ctx}>
        <BlankSlate
          placement="inline"
          error
          icon={<CircleExclamationIcon />}
          title="Couldn't load the creators"
          code={fetchError}
          description="Close this dialog and try again."
        />
        <div className={styles.footer}>{cancel}</div>
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx} texts={TEXTS}>
      <form onSubmit={handleSubmit}>
        {partialListWarning && (
          <Callout
            tone="warning"
            title="Some creators couldn't be loaded"
            className={styles.callout}
          >
            Only the available creators are listed. {partialListWarning}
          </Callout>
        )}
        {isContinuousExecution && (
          <Callout title="This can take hours" className={styles.callout}>
            Keep this dialog open until the change finishes.
          </Callout>
        )}
        <FieldWrapper
          label="New creator"
          required
          hint={{
            id: 'bulkChangeAuthor.newCreatorHint',
            values: { count: itemCount },
          }}
          error={selectionError ?? undefined}
        >
          <SelectInput<Option, OptionGroup<Option>>
            value={selectedUser?.value ?? null}
            onChange={(_value, option) => handleSelectChange(option)}
            options={optionGroups}
            formatOptionLabel={formatOptionLabel}
            clearable={false}
            loading={isLoading}
            disabled={isLoading || isRunning}
            placeholder={
              isLoading || hasOptions
                ? 'Pick a creator'
                : 'No creators available'
            }
          />
        </FieldWrapper>
        {isRunning && progress && <ExecutionProgress progress={progress} />}
        <div className={styles.footer}>
          {isRunning ? (
            <Button
              tone="ghost"
              label="Stop"
              busy={progress?.stopping}
              onClick={handleStop}
            />
          ) : (
            cancel
          )}
          <Button
            submit
            tone="primary"
            label="Change creator"
            busy={isRunning}
            disabled={
              isLoading
                ? { reason: 'Wait for the creators to load.' }
                : !selectedUser && { reason: 'Pick the new creator first.' }
            }
          />
        </div>
      </form>
    </Canvas>
  );
}

function buildOptionGroups(
  collaborators: Option[],
  ssoUsers: Option[],
  ownerOption: Option | null,
): OptionGroup<Option>[] {
  const groups: OptionGroup<Option>[] = [];

  if (ownerOption) {
    groups.push({ label: 'Project owner', options: [ownerOption] });
  }

  if (collaborators.length > 0) {
    groups.push({ label: 'Collaborators', options: collaborators });
  }

  if (ssoUsers.length > 0) {
    groups.push({ label: 'SSO users', options: ssoUsers });
  }

  return groups;
}

function flattenOptionGroups(groups: OptionGroup<Option>[]): Option[] {
  return groups.flatMap((group) => group.options);
}

function toOption(user: UserRowEntityWithId, userType: CreatorType): Option {
  const { name, email } = userPresentation(user);
  const fallback =
    userType === 'sso_user' ? `SSO user ${user.id}` : `User ${user.id}`;

  return {
    label: formatLabel(name ?? undefined, email ?? undefined, fallback),
    value: `${userType}:${user.id}`,
    id: user.id,
    userType,
    user,
  };
}

function toOwnerOption(owner: UserRowEntityWithId): Option | null {
  if (owner.type !== 'account' && owner.type !== 'organization') {
    return null;
  }

  return toOption(owner, owner.type);
}

function formatLabel(
  primary: string | undefined,
  secondary: string | undefined,
  fallback: string,
): string {
  if (primary && secondary && primary !== secondary) {
    return `${primary} (${secondary})`;
  }

  return primary ?? secondary ?? fallback;
}
