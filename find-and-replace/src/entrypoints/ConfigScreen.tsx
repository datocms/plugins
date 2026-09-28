import type { Client } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  FieldGroup,
  SelectField,
  Spinner,
  SwitchField,
} from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
import type { ModelSummary, PluginParameters, RoleSummary } from '../types';
import { buildCmaClient } from '../utils/cma';
import { readPluginParameters } from '../utils/parameters';
import { loadModels, loadRoles } from '../utils/schema';
import s from './ConfigScreen.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type SelectOption = {
  label: string;
  value: string;
};

type SingleValue<T> = T | null;
type MultiValue<T> = readonly T[];
type SelectChangeValue =
  | SingleValue<SelectOption>
  | MultiValue<SelectOption>
  | readonly (SelectOption | MultiValue<SelectOption>)[];

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

function toPayload(state: DraftState): PluginParameters {
  return {
    restrictToRoles: state.restrictToRoles,
    allowedRoleIds: state.allowedRoleIds,
    restrictToModels: state.restrictToModels,
    allowedModelIds: state.allowedModelIds,
  };
}

function isSelectOption(value: unknown): value is SelectOption {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    'label' in (value as Record<string, unknown>) &&
    'value' in (value as Record<string, unknown>)
  );
}

function toOptionArray(value: SelectChangeValue): SelectOption[] {
  if (!Array.isArray(value)) {
    return isSelectOption(value) ? [value] : [];
  }

  const options: SelectOption[] = [];

  for (const entry of value) {
    if (Array.isArray(entry)) {
      for (const nested of entry) {
        if (isSelectOption(nested)) {
          options.push(nested);
        }
      }
      continue;
    }

    if (isSelectOption(entry)) {
      options.push(entry);
    }
  }

  return options;
}

function toModelOption(model: ModelSummary): SelectOption {
  return {
    label: `${model.name} (${model.id})`,
    value: model.id,
  };
}

function toRoleOption(role: RoleSummary): SelectOption {
  return {
    label: `${role.name} (${role.id})`,
    value: role.id,
  };
}

function selectedOptions(
  value: string[],
  options: SelectOption[],
): SelectOption[] {
  const optionMap = new Map(options.map((option) => [option.value, option]));

  return value.map(
    (entry) => optionMap.get(entry) ?? { label: entry, value: entry },
  );
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

type ProjectOptions = {
  availableModels: ModelSummary[];
  availableRoles: RoleSummary[];
  isLoadingOptions: boolean;
  loadError: string | null;
};

/** Loads the project's models and roles for the selectors. */
function useProjectOptions(client: Client | null): ProjectOptions {
  const [availableModels, setAvailableModels] = useState<ModelSummary[]>([]);
  const [availableRoles, setAvailableRoles] = useState<RoleSummary[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) {
      setIsLoadingOptions(false);
      setLoadError(
        'Grant currentUserAccessToken to load project roles and models.',
      );
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
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Failed to load project roles and models.',
          );
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

function selectionErrors(draft: DraftState): {
  roleSelectionError: string | null;
  modelSelectionError: string | null;
} {
  return {
    roleSelectionError:
      draft.restrictToRoles && draft.allowedRoleIds.length === 0
        ? 'Select at least one role.'
        : null,
    modelSelectionError:
      draft.restrictToModels && draft.allowedModelIds.length === 0
        ? 'Select at least one model.'
        : null,
  };
}

/** The loading spinner and the load error, shown under an active restriction. */
function OptionsNotice({
  isLoadingOptions,
  loadError,
}: Pick<ProjectOptions, 'isLoadingOptions' | 'loadError'>) {
  return (
    <>
      {isLoadingOptions && (
        <div className={s.notice}>
          <Spinner size={24} />
        </div>
      )}
      {loadError && <p className={s.notice}>{loadError}</p>}
    </>
  );
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
  const { availableModels, availableRoles, isLoadingOptions, loadError } =
    useProjectOptions(client);

  const canEditSchema = ctx.currentRole.meta.final_permissions.can_edit_schema;

  useEffect(() => {
    setDraft(toDraftState(params));
  }, [params]);

  const modelOptions = useMemo<SelectOption[]>(
    () => availableModels.map(toModelOption),
    [availableModels],
  );
  const roleOptions = useMemo<SelectOption[]>(
    () => availableRoles.map(toRoleOption),
    [availableRoles],
  );
  const isDirty = useMemo(() => isDraftDirty(draft, params), [draft, params]);
  const { roleSelectionError, modelSelectionError } = selectionErrors(draft);
  const hasValidationError = Boolean(roleSelectionError || modelSelectionError);
  const hasRestriction = draft.restrictToRoles || draft.restrictToModels;

  async function handleSave() {
    if (!canEditSchema) {
      ctx.alert('Your role cannot update plugin settings.');
      return;
    }

    if (hasValidationError) {
      return;
    }

    setIsSaving(true);

    try {
      await ctx.updatePluginParameters(toPayload(draft));
      ctx.notice('Settings successfully saved!');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Canvas ctx={ctx}>
      <div className={s.container}>
        <p className={s.instructions}>
          By default, every role and model allowed by DatoCMS permissions is
          available. Turn on a restriction only when Find and Replace should be
          limited further.
        </p>
        <FieldGroup>
          <div className={s.restriction}>
            <SwitchField
              name="restrictToRoles"
              id="restrictToRoles"
              label="Allow only certain roles to bulk update"
              value={draft.restrictToRoles}
              onChange={(restrictToRoles) =>
                setDraft((current) => ({ ...current, restrictToRoles }))
              }
              switchInputProps={{
                name: 'restrictToRoles',
                value: draft.restrictToRoles,
                disabled: !canEditSchema,
              }}
            />
            {draft.restrictToRoles && (
              <div className={s.restrictionSelector}>
                <SelectField
                  name="allowedRoleIds"
                  id="allowedRoleIds"
                  label="Roles allowed to bulk update"
                  hint="Only the selected roles can open Find and Replace."
                  error={roleSelectionError ?? undefined}
                  value={selectedOptions(draft.allowedRoleIds, roleOptions)}
                  selectInputProps={{
                    inputId: 'allowedRoleIds-input',
                    'aria-label': 'Roles allowed to bulk update',
                    isMulti: true,
                    options: roleOptions,
                    isDisabled: isLoadingOptions || !canEditSchema,
                  }}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      allowedRoleIds: toOptionArray(value).map(
                        (option) => option.value,
                      ),
                    }))
                  }
                />
              </div>
            )}
          </div>
          <div className={s.restriction}>
            <SwitchField
              name="restrictToModels"
              id="restrictToModels"
              label="Allow only certain models to be bulk updated"
              value={draft.restrictToModels}
              onChange={(restrictToModels) =>
                setDraft((current) => ({ ...current, restrictToModels }))
              }
              switchInputProps={{
                name: 'restrictToModels',
                value: draft.restrictToModels,
                disabled: !canEditSchema,
              }}
            />
            {draft.restrictToModels && (
              <div className={s.restrictionSelector}>
                <SelectField
                  name="allowedModelIds"
                  id="allowedModelIds"
                  label="Models allowed for bulk updates"
                  hint="Only the selected models are available in Find and Replace."
                  error={modelSelectionError ?? undefined}
                  value={selectedOptions(draft.allowedModelIds, modelOptions)}
                  selectInputProps={{
                    inputId: 'allowedModelIds-input',
                    'aria-label': 'Models allowed for bulk updates',
                    isMulti: true,
                    options: modelOptions,
                    isDisabled: isLoadingOptions || !canEditSchema,
                  }}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      allowedModelIds: toOptionArray(value).map(
                        (option) => option.value,
                      ),
                    }))
                  }
                />
              </div>
            )}
          </div>
        </FieldGroup>
        {hasRestriction && (
          <OptionsNotice
            isLoadingOptions={isLoadingOptions}
            loadError={loadError}
          />
        )}
        <div className={s.actions}>
          <Button
            fullWidth
            buttonType="primary"
            onClick={handleSave}
            disabled={
              !isDirty || isSaving || !canEditSchema || hasValidationError
            }
          >
            {isSaving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
        {!canEditSchema && (
          <p className={s.notice}>
            Your role can use Find and Replace if allowed, but cannot change
            plugin settings.
          </p>
        )}
      </div>
    </Canvas>
  );
}
