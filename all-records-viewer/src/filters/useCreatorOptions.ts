import type { Client } from '@datocms/cma-client-browser';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useEffect, useState } from 'react';

export type CreatorOption = { value: string; label: string };

type CreatorOptionsState = {
  options: readonly CreatorOption[];
  loading: boolean;
};

const NO_OPTIONS: CreatorOptionsState = { options: [], loading: false };

type Owner = RenderPageCtx['owner'];

// The owner of the project, the people and the API tokens that can create
// records: the options of a "Creator" tile. A list that the role of the user
// can't read is left out.
async function loadCreators(
  client: Client,
  owner: Owner,
): Promise<CreatorOption[]> {
  const [users, ssoUsers, tokens] = await Promise.all([
    client.users.list().catch(() => []),
    client.ssoUsers.list().catch(() => []),
    client.accessTokens.list().catch(() => []),
  ]);
  const options: CreatorOption[] = [
    ...users.map((user) => ({
      value: `user:${user.id}`,
      label: user.full_name || user.email,
    })),
    ...ssoUsers.map((user) => ({
      value: `sso_user:${user.id}`,
      label:
        [user.first_name, user.last_name].filter(Boolean).join(' ') ||
        user.username,
    })),
    ...tokens.map((token) => ({
      value: `access_token:${token.id}`,
      label: token.name,
    })),
  ];
  options.sort((left, right) => left.label.localeCompare(right.label));
  return [
    {
      value: `${owner.type}:${owner.id}`,
      label:
        owner.type === 'account'
          ? owner.attributes.company ||
            [owner.attributes.first_name, owner.attributes.last_name]
              .filter(Boolean)
              .join(' ') ||
            owner.attributes.email
          : owner.attributes.name,
    },
    ...options,
  ];
}

/** The creators, loaded once a tile needs them */
export function useCreatorOptions(
  client: Client | null,
  owner: Owner,
  enabled: boolean,
): CreatorOptionsState {
  const [state, setState] = useState<{
    client: Client;
    value: CreatorOptionsState;
  } | null>(null);
  const loadedForClient = state?.client === client;

  useEffect(() => {
    if (!enabled || !client || loadedForClient) return;
    setState({ client, value: { options: [], loading: true } });
    // The list ends even when the tile goes: the next tile reuses it
    void loadCreators(client, owner).then((options) =>
      setState((current) =>
        current?.client === client
          ? { client, value: { options, loading: false } }
          : current,
      ),
    );
  }, [client, enabled, loadedForClient, owner]);

  return loadedForClient && state ? state.value : NO_OPTIONS;
}
