import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Form, SelectField } from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
import { makeClient } from '../services/cmaClient';
import styles from './SelectCreatorModal.module.css';

type Props = {
  ctx: RenderModalCtx;
};

type CreatorType = 'user' | 'sso_user' | 'account' | 'organization';

type ModalParameters = {
  preselectedUserId?: string;
  preselectedUserType?: CreatorType;
  itemCount?: number;
};

type Option = {
  label: string;
  value: string;
  userType: CreatorType;
};

type SingleValue<T> = T | null;
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
    const matchesId = option.value === preselectedUserId;
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

type FetchUserOptionsResult = {
  nextOptionGroups: OptionGroup<Option>[];
  allOptions: Option[];
  firstRejectionReason: unknown | null;
};

async function fetchUserOptions(
  accessToken: string,
  environment: string,
): Promise<FetchUserOptionsResult> {
  const client = makeClient(accessToken, environment);
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

export default function SelectCreatorModal({ ctx }: Props) {
  const params = useMemo<ModalParameters>(() => {
    return (ctx.parameters as ModalParameters) ?? {};
  }, [ctx.parameters]);

  const itemCount = params.itemCount ?? 0;
  const [optionGroups, setOptionGroups] = useState<OptionGroup<Option>[]>([]);
  const [selectedUser, setSelectedUser] = useState<Option | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const hasOptions = optionGroups.some((group) => group.options.length > 0);

  useEffect(() => {
    let cancelled = false;

    async function applyFetchedUsers(accessToken: string) {
      const { nextOptionGroups, allOptions, firstRejectionReason } =
        await fetchUserOptions(accessToken, ctx.environment);

      if (cancelled) {
        return;
      }

      setOptionGroups(nextOptionGroups);

      const preselectedOption = findPreselectedOption(
        allOptions,
        params.preselectedUserId,
        params.preselectedUserType,
      );

      if (params.preselectedUserId) {
        setSelectedUser(preselectedOption);
      } else if (allOptions.length === 0) {
        setSelectedUser(null);
      }

      if (firstRejectionReason !== null && allOptions.length === 0) {
        setFetchError(resolveErrorMessage(firstRejectionReason));
      }
    }

    async function loadUsers() {
      if (!ctx.currentUserAccessToken) {
        setFetchError(
          "The plugin is missing the 'currentUserAccessToken' permission required to load users.",
        );
        setOptionGroups([]);
        setSelectedUser(null);
        return;
      }

      setIsLoading(true);
      setFetchError(null);

      try {
        await applyFetchedUsers(ctx.currentUserAccessToken);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setFetchError(resolveErrorMessage(error));
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
    params.preselectedUserId,
    params.preselectedUserType,
  ]);

  const title = useMemo(() => {
    if (itemCount <= 0) {
      return 'Change creators';
    }
    const plural = itemCount === 1 ? 'record' : 'records';
    return `Change creators for ${itemCount} ${plural}`;
  }, [itemCount]);

  const errorMessage = fetchError ?? selectionError ?? undefined;

  const handleSelectChange = (option: SingleValue<Option>) => {
    setSelectedUser(option ?? null);
    setSelectionError(null);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser) {
      setSelectionError(
        'Select a collaborator, SSO user, or project owner to continue.',
      );
      return;
    }
    ctx.resolve({
      userId: selectedUser.value,
      userType: selectedUser.userType,
    });
  };

  const handleCancel = () => {
    ctx.resolve(null);
  };

  return (
    <Canvas ctx={ctx}>
      <Form onSubmit={handleSubmit} className={styles.form}>
        <header className={styles.header}>
          <h2 className={styles.heading}>{title}</h2>
          <p className={styles.subheading}>
            Select a collaborator, SSO user, or project owner to assign as the
            new creator for the chosen records.
          </p>
        </header>
        <SelectField<Option, false, OptionGroup<Option>>
          id="new-creator"
          name="new-creator"
          label="New creator"
          required
          value={selectedUser}
          onChange={handleSelectChange}
          hint="Collaborators, SSO users, and the project owner are listed."
          error={errorMessage}
          selectInputProps={{
            options: optionGroups,
            isClearable: false,
            isDisabled: isLoading || Boolean(fetchError),
            isLoading,
            placeholder: isLoading
              ? 'Loading users…'
              : hasOptions
                ? 'Choose a collaborator, SSO user, or project owner'
                : 'No users available',
          }}
        />
        <footer className={styles.footer}>
          <Button
            type="submit"
            buttonType="primary"
            disabled={isLoading || Boolean(fetchError) || !selectedUser}
          >
            Change creator
          </Button>
          <Button type="button" buttonType="muted" onClick={handleCancel}>
            Cancel
          </Button>
        </footer>
      </Form>
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

  return { label, value: user.id, userType: 'user' };
}

function toSsoOption(user: RawSsoUser): Option {
  const attributes = user.attributes ?? {};
  const name = firstNonEmpty(
    joinName(attributes.first_name, attributes.last_name),
    joinName(user.first_name, user.last_name),
  );
  const username = firstNonEmpty(attributes.username, user.username);
  const label = formatLabel(name, username, `SSO user ${user.id}`);

  return { label, value: user.id, userType: 'sso_user' };
}

function toOwnerOption(owner: RawSiteOwner | null): Option | null {
  if (!owner) {
    return null;
  }

  const suffix =
    owner.type === 'organization' ? 'organization' : 'personal account';
  return {
    label: `Project owner (${suffix})`,
    value: owner.id,
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

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return 'Unable to load users.';
}
