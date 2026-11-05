import type { RenderModalCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas, { useCtx } from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import SelectInput from 'datocms-react-ui/SelectInput';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type BulkProgress,
  bulkChangeCreator,
  type CreatorType,
} from '../actions/bulkChangeCreator';
import { CircleExclamationIcon } from '../icons';
import { makeClient } from '../services/cmaClient';
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
// select's value joins the type and the id, and `id` keeps the bare id
type Option = {
  label: string;
  value: string;
  id: string;
  userType: CreatorType;
};

type OptionGroup<T> = {
  label?: string;
  options: T[];
};

type RawCollaborator = {
  id: string;
  attributes?: {
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  };
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type RawSsoUser = {
  id: string;
  attributes?: {
    first_name?: string | null;
    last_name?: string | null;
    username?: string | null;
  };
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
};

type RawSiteOwner = {
  id: string;
  type: 'account' | 'organization';
};

type ApiResults = {
  collaboratorsResult: PromiseSettledResult<unknown>;
  ssoUsersResult: PromiseSettledResult<unknown>;
  siteResult: PromiseSettledResult<unknown>;
};

function buildOptionsFromApiResults({
  collaboratorsResult,
  ssoUsersResult,
  siteResult,
}: ApiResults): {
  nextOptionGroups: OptionGroup<Option>[];
  allOptions: Option[];
  firstRejectionReason: unknown | null;
} {
  const collaboratorOptions =
    collaboratorsResult.status === 'fulfilled'
      ? extractCollaborators(collaboratorsResult.value).map(
          toCollaboratorOption,
        )
      : [];
  const ssoOptions =
    ssoUsersResult.status === 'fulfilled'
      ? extractSsoUsers(ssoUsersResult.value).map(toSsoOption)
      : [];
  const ownerOption =
    siteResult.status === 'fulfilled'
      ? toOwnerOption(extractSiteOwner(siteResult.value))
      : null;

  const nextOptionGroups = buildOptionGroups(
    collaboratorOptions,
    ssoOptions,
    ownerOption,
  );
  const allOptions = flattenOptionGroups(nextOptionGroups);

  const rejectedResults = [
    collaboratorsResult,
    ssoUsersResult,
    siteResult,
  ].filter(
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

async function fetchUserOptions(
  accessToken: string,
  environment: string,
  baseUrl?: string,
): Promise<FetchUserOptionsResult> {
  const client = makeClient(accessToken, environment, baseUrl);
  const [collaboratorsResult, ssoUsersResult, siteResult] =
    await Promise.allSettled([
      client.users.list(),
      client.ssoUsers.list(),
      client.site.find(),
    ]);

  return buildOptionsFromApiResults({
    collaboratorsResult,
    ssoUsersResult,
    siteResult,
  });
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

  useEffect(() => {
    let cancelled = false;

    async function applyFetchedUsers(accessToken: string) {
      const { nextOptionGroups, allOptions, firstRejectionReason } =
        await fetchUserOptions(accessToken, ctx.environment, ctx.cmaBaseUrl);

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
        setFetchError(describeApiError(firstRejectionReason));
      } else {
        setPartialListWarning(describeApiError(firstRejectionReason));
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
        await applyFetchedUsers(ctx.currentUserAccessToken);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setFetchError(describeApiError(error));
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
    ctx.environment,
    ctx.cmaBaseUrl,
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

function extractCollaborators(result: unknown): RawCollaborator[] {
  return extractFromCollection(result, isRawCollaborator);
}

function extractSsoUsers(result: unknown): RawSsoUser[] {
  return extractFromCollection(result, isRawSsoUser);
}

function extractSiteOwner(result: unknown): RawSiteOwner | null {
  if (!result || typeof result !== 'object' || !('owner' in result)) {
    return null;
  }

  const owner = (result as { owner?: unknown }).owner;
  if (!owner || typeof owner !== 'object') {
    return null;
  }

  const id = (owner as { id?: unknown }).id;
  const type = (owner as { type?: unknown }).type;
  if (typeof id !== 'string') {
    return null;
  }

  if (type !== 'account' && type !== 'organization') {
    return null;
  }

  return { id, type };
}

function extractFromCollection<T>(
  result: unknown,
  guard: (value: unknown) => value is T,
): T[] {
  if (Array.isArray(result)) {
    return result.filter(guard);
  }

  if (result && typeof result === 'object' && 'data' in result) {
    const data = (result as { data?: unknown }).data;
    if (Array.isArray(data)) {
      return data.filter(guard);
    }
  }

  return [];
}

function isRawCollaborator(value: unknown): value is RawCollaborator {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return 'id' in value && typeof (value as { id: unknown }).id === 'string';
}

function isRawSsoUser(value: unknown): value is RawSsoUser {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return 'id' in value && typeof (value as { id: unknown }).id === 'string';
}

function toCollaboratorOption(user: RawCollaborator): Option {
  const attributes = user.attributes ?? {};
  const name = firstNonEmpty(
    attributes.full_name,
    user.full_name,
    joinName(attributes.first_name, attributes.last_name),
    joinName(user.first_name, user.last_name),
  );
  const email = firstNonEmpty(attributes.email, user.email);
  const label = formatLabel(name, email, `User ${user.id}`);

  return { label, value: `user:${user.id}`, id: user.id, userType: 'user' };
}

function toSsoOption(user: RawSsoUser): Option {
  const attributes = user.attributes ?? {};
  const name = firstNonEmpty(
    joinName(attributes.first_name, attributes.last_name),
    joinName(user.first_name, user.last_name),
  );
  const username = firstNonEmpty(attributes.username, user.username);
  const label = formatLabel(name, username, `SSO user ${user.id}`);

  return {
    label,
    value: `sso_user:${user.id}`,
    id: user.id,
    userType: 'sso_user',
  };
}

function toOwnerOption(owner: RawSiteOwner | null): Option | null {
  if (!owner) {
    return null;
  }

  const suffix =
    owner.type === 'organization' ? 'organization' : 'personal account';
  return {
    label: `Project owner (${suffix})`,
    value: `${owner.type}:${owner.id}`,
    id: owner.id,
    userType: owner.type,
  };
}

function joinName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | undefined {
  const first = firstNonEmpty(firstName);
  const last = firstNonEmpty(lastName);
  const name = [first, last].filter(Boolean).join(' ');
  return name.length > 0 ? name : undefined;
}

function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return undefined;
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
