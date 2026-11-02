import type { Client } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import RadioGroupInput, {
  type RadioGroupOption,
} from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { ModelSummary, PluginParameters, RoleSummary } from '../types';
import { buildCmaClient } from '../utils/cma';
import { readPluginParameters } from '../utils/parameters';
import { loadModels, loadRoles } from '../utils/schema';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type SelectOption = {
  label: string;
  value: string;
};

type DraftState = {
  restrictToRoles: boolean;
  allowedRoleIds: string[];
  restrictToModels: boolean;
  allowedModelIds: string[];
};

function toDraftState(params: PluginParameters): DraftState {
  return {
    restrictToRoles: params.restrictToRoles,
    allowedRoleIds: params.allowedRoleIds,
    restrictToModels: params.restrictToModels,
    allowedModelIds: params.allowedModelIds,
  };
}

/** The saved parameters: exactly these four keys. */
function toPayload(state: DraftState): PluginParameters {
  return {
    restrictToRoles: state.restrictToRoles,
    allowedRoleIds: state.allowedRoleIds,
    restrictToModels: state.restrictToModels,
    allowedModelIds: state.allowedModelIds,
  };
}

/**
 * The options of a select: the name, and the ID in parentheses only when
 * another option has the same name.
 */
function toOptions(
  items: ReadonlyArray<{ id: string; name: string }>,
): SelectOption[] {
  const namesSeen = new Map<string, number>();
  for (const item of items) {
    namesSeen.set(item.name, (namesSeen.get(item.name) ?? 0) + 1);
  }

  return items.map((item) => ({
    value: item.id,
    label:
      (namesSeen.get(item.name) ?? 0) > 1
        ? `${item.name} (${item.id})`
        : item.name,
  }));
}

type OptionsState = 'loading' | 'loaded' | 'failed';

function optionsStateOf(
  loading: boolean,
  loadError: LoadError | null,
): OptionsState {
  if (loading) {
    return 'loading';
  }
  return loadError ? 'failed' : 'loaded';
}

/**
 * A saved ID that no option has still shows, named by what it is: once the
 * options are loaded it was deleted; if they couldn't load, it is unknown.
 * While they load, it waits for them (the select shows its spinner).
 */
function savedIdOption(
  kind: 'role' | 'model',
  state: OptionsState,
): (value: string) => SelectOption | undefined {
  return (value) => {
    switch (state) {
      case 'loading':
        return undefined;
      case 'loaded':
        return { value, label: `Deleted ${kind} (${value})` };
      case 'failed':
        return { value, label: `Unknown ${kind} (${value})` };
    }
  };
}

function normalizeIds(value: string[]): string[] {
  return [...new Set(value)].sort((left, right) => left.localeCompare(right));
}

function sameIds(left: string[], right: string[]): boolean {
  return (
    JSON.stringify(normalizeIds(left)) === JSON.stringify(normalizeIds(right))
  );
}

function isDraftDirty(draft: DraftState, params: PluginParameters): boolean {
  return (
    draft.restrictToRoles !== params.restrictToRoles ||
    !sameIds(draft.allowedRoleIds, params.allowedRoleIds) ||
    draft.restrictToModels !== params.restrictToModels ||
    !sameIds(draft.allowedModelIds, params.allowedModelIds)
  );
}

/** A callout's text, with a title when it takes two sentences. */
type LoadError = { title: string | null; text: string };

const NO_TOKEN_ERROR: LoadError = {
  title: "Couldn't load the roles and models",
  text: "The plugin needs access to your API token. Grant it in the plugin's permissions, then reload the page.",
};

const LOAD_FAILED_ERROR: LoadError = {
  title: "Couldn't load the roles and models",
  text: 'Reload the page to try again.',
};

type ProjectOptions = {
  availableModels: ModelSummary[];
  availableRoles: RoleSummary[];
  isLoadingOptions: boolean;
  loadError: LoadError | null;
};

/** Loads the project's models and roles for the selectors. */
function useProjectOptions(client: Client | null): ProjectOptions {
  const [availableModels, setAvailableModels] = useState<ModelSummary[]>([]);
  const [availableRoles, setAvailableRoles] = useState<RoleSummary[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);

  useEffect(() => {
    if (!client) {
      setIsLoadingOptions(false);
      setLoadError(NO_TOKEN_ERROR);
      return;
    }

    let cancelled = false;
    setIsLoadingOptions(true);
    setLoadError(null);

    Promise.all([loadModels(client), loadRoles(client)])
      .then(([models, roles]) => {
        if (cancelled) {
          return;
        }
        setAvailableModels(models);
        setAvailableRoles(roles);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(LOAD_FAILED_ERROR);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingOptions(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  return { availableModels, availableRoles, isLoadingOptions, loadError };
}

function clientFor(
  token: string | undefined,
  environment: string,
  cmaBaseUrl: string,
): Client | null {
  return token
    ? buildCmaClient({ currentUserAccessToken: token, environment, cmaBaseUrl })
    : null;
}

/**
 * Each restriction is a boolean whose two answers need a name, so it is a
 * pair of radios: 'all' stores false, 'some' stores true.
 */
type Scope = 'all' | 'some';

const toScope = (restricted: boolean): Scope => (restricted ? 'some' : 'all');

const ROLE_SCOPES: ReadonlyArray<RadioGroupOption<Scope>> = [
  { value: 'all', label: 'Every role that can edit records' },
  { value: 'some', label: 'Only some roles' },
];

const MODEL_SCOPES: ReadonlyArray<RadioGroupOption<Scope>> = [
  { value: 'all', label: 'Every model the role can edit' },
  { value: 'some', label: 'Only some models' },
];

const ROLE_SELECTION_ERROR = 'Select at least one role.';
const MODEL_SELECTION_ERROR = 'Select at least one model.';

function selectionErrors(draft: DraftState): {
  roleSelectionError: string | null;
  modelSelectionError: string | null;
} {
  return {
    roleSelectionError:
      draft.restrictToRoles && draft.allowedRoleIds.length === 0
        ? ROLE_SELECTION_ERROR
        : null,
    modelSelectionError:
      draft.restrictToModels && draft.allowedModelIds.length === 0
        ? MODEL_SELECTION_ERROR
        : null,
  };
}

/** Why Save is unavailable, or undefined when it can save. */
function saveDisabledReason({
  isDirty,
  roleSelectionError,
  modelSelectionError,
}: {
  isDirty: boolean;
  roleSelectionError: string | null;
  modelSelectionError: string | null;
}): { reason: string } | undefined {
  if (!isDirty) {
    return { reason: 'There are no changes to save.' };
  }
  if (roleSelectionError && modelSelectionError) {
    return { reason: 'Select at least one role and one model.' };
  }
  const selectionError = roleSelectionError ?? modelSelectionError;
  return selectionError ? { reason: selectionError } : undefined;
}

export default function ConfigScreen({ ctx }: Props) {
  const params = useMemo(
    () => readPluginParameters(ctx.plugin.attributes.parameters),
    [ctx.plugin.attributes.parameters],
  );
  const { currentUserAccessToken, environment, cmaBaseUrl } = ctx;
  const client = useMemo(
    () => clientFor(currentUserAccessToken, environment, cmaBaseUrl),
    [currentUserAccessToken, environment, cmaBaseUrl],
  );
  const [draft, setDraft] = useState<DraftState>(() => toDraftState(params));
  const [isSaving, setIsSaving] = useState(false);
  // A selection error shows once its select was used: its menu was opened
  // and closed, or its value changed. Save says why it waits meanwhile.
  const [touched, setTouched] = useState({ roles: false, models: false });
  const touchRoles = () =>
    setTouched((current) => ({ ...current, roles: true }));
  const touchModels = () =>
    setTouched((current) => ({ ...current, models: true }));
  const { availableModels, availableRoles, isLoadingOptions, loadError } =
    useProjectOptions(client);
  const optionsState = optionsStateOf(isLoadingOptions, loadError);
  const savedRoleOption = useMemo(
    () => savedIdOption('role', optionsState),
    [optionsState],
  );
  const savedModelOption = useMemo(
    () => savedIdOption('model', optionsState),
    [optionsState],
  );

  const canEditSchema = ctx.currentRole.meta.final_permissions.can_edit_schema;
  // Without the lists, the saved roles and models show but stay as they are:
  // nothing could be picked again once removed.
  const selectsLocked = !canEditSchema || optionsState === 'failed';

  useEffect(() => {
    setDraft(toDraftState(params));
  }, [params]);

  const modelOptions = useMemo(
    () => toOptions(availableModels),
    [availableModels],
  );
  const roleOptions = useMemo(
    () => toOptions(availableRoles),
    [availableRoles],
  );
  const isDirty = useMemo(() => isDraftDirty(draft, params), [draft, params]);
  const { roleSelectionError, modelSelectionError } = selectionErrors(draft);
  const hasValidationError = Boolean(roleSelectionError || modelSelectionError);
  const hasRestriction = draft.restrictToRoles || draft.restrictToModels;
  const disabledReason = saveDisabledReason({
    isDirty,
    roleSelectionError,
    modelSelectionError,
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    if (!canEditSchema) {
      ctx.alert("Your role can't change these settings.");
      return;
    }

    if (!isDirty || hasValidationError) {
      return;
    }

    setIsSaving(true);

    try {
      await ctx.updatePluginParameters(toPayload(draft));
      ctx.notice('Settings saved');
    } catch {
      ctx.alert("Couldn't save the settings. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Canvas ctx={ctx}>
      <Page>
        <Page.Content>
          {!canEditSchema && (
            <Callout>Your role can't change these settings.</Callout>
          )}
          <form onSubmit={handleSubmit}>
            <Page.Group
              title="Access"
              footer={
                // A role that can't change the settings has nothing to save.
                canEditSchema ? (
                  <Button
                    submit
                    tone="primary"
                    label="Save"
                    busy={isSaving}
                    disabled={disabledReason}
                  />
                ) : undefined
              }
            >
              {hasRestriction && loadError && (
                <Callout tone="danger" title={loadError.title ?? undefined}>
                  {loadError.text}
                </Callout>
              )}
              <FieldWrapper label="Who can use Find and replace">
                <RadioGroupInput
                  value={toScope(draft.restrictToRoles)}
                  options={ROLE_SCOPES}
                  disabled={!canEditSchema}
                  onChange={(scope) =>
                    setDraft((current) => ({
                      ...current,
                      restrictToRoles: scope === 'some',
                    }))
                  }
                />
              </FieldWrapper>
              {draft.restrictToRoles && (
                <FieldWrapper
                  label="Roles"
                  hint="Only these roles see Find and replace in the navigation and can open it."
                  error={(touched.roles && roleSelectionError) || undefined}
                >
                  <SelectInput
                    multiple
                    value={draft.allowedRoleIds}
                    options={roleOptions}
                    loading={isLoadingOptions}
                    disabled={selectsLocked}
                    acceptValueNotIncludedInOptions={savedRoleOption}
                    onBlur={touchRoles}
                    onMenuClose={touchRoles}
                    onChange={(allowedRoleIds) =>
                      setDraft((current) => ({
                        ...current,
                        allowedRoleIds: allowedRoleIds ?? [],
                      }))
                    }
                  />
                </FieldWrapper>
              )}
              <FieldWrapper label="Models it searches">
                <RadioGroupInput
                  value={toScope(draft.restrictToModels)}
                  options={MODEL_SCOPES}
                  disabled={!canEditSchema}
                  onChange={(scope) =>
                    setDraft((current) => ({
                      ...current,
                      restrictToModels: scope === 'some',
                    }))
                  }
                />
              </FieldWrapper>
              {draft.restrictToModels && (
                <FieldWrapper
                  label="Models"
                  error={(touched.models && modelSelectionError) || undefined}
                >
                  <SelectInput
                    multiple
                    value={draft.allowedModelIds}
                    options={modelOptions}
                    loading={isLoadingOptions}
                    disabled={selectsLocked}
                    acceptValueNotIncludedInOptions={savedModelOption}
                    onBlur={touchModels}
                    onMenuClose={touchModels}
                    onChange={(allowedModelIds) =>
                      setDraft((current) => ({
                        ...current,
                        allowedModelIds: allowedModelIds ?? [],
                      }))
                    }
                  />
                </FieldWrapper>
              )}
            </Page.Group>
          </form>
        </Page.Content>
      </Page>
    </Canvas>
  );
}
