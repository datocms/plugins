import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  FieldGroup,
  SelectField,
  Spinner,
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
  allowedRoleIds: string[];
  allowedModelIds: string[];
};

function toDraftState(params: PluginParameters): DraftState {
  return {
    allowedRoleIds: params.allowedRoleIds,
    allowedModelIds: params.allowedModelIds,
  };
}

function toPayload(state: DraftState): PluginParameters {
  return {
    allowedRoleIds: state.allowedRoleIds,
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

function selectedOptions(value: string[], options: SelectOption[]): SelectOption[] {
  const optionMap = new Map(options.map((option) => [option.value, option]));

  return value.map((entry) => optionMap.get(entry) ?? { label: entry, value: entry });
}

function normalizeIds(value: string[]): string[] {
  return [...new Set(value)].sort((left, right) => left.localeCompare(right));
}

export default function ConfigScreen({ ctx }: Props) {
  const params = useMemo(
    () => readPluginParameters(ctx.plugin.attributes.parameters),
    [ctx.plugin.attributes.parameters],
  );
  const client = useMemo(
    () => (ctx.currentUserAccessToken ? buildCmaClient(ctx) : null),
    [ctx.currentUserAccessToken, ctx.environment],
  );
  const [draft, setDraft] = useState<DraftState>(() => toDraftState(params));
  const [availableModels, setAvailableModels] = useState<ModelSummary[]>([]);
  const [availableRoles, setAvailableRoles] = useState<RoleSummary[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canEditSchema = ctx.currentRole.meta.final_permissions.can_edit_schema;

  useEffect(() => {
    setDraft(toDraftState(params));
  }, [params]);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      if (!client) {
        setIsLoadingOptions(false);
        setLoadError('Grant currentUserAccessToken to load project roles and models.');
        return;
      }

      setIsLoadingOptions(true);
      setLoadError(null);

      try {
        const [models, roles] = await Promise.all([
          loadModels(client),
          loadRoles(client),
        ]);

        if (cancelled) {
          return;
        }

        setAvailableModels(models);
        setAvailableRoles(roles);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : 'Failed to load project roles and models.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingOptions(false);
        }
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const modelOptions = useMemo<SelectOption[]>(
    () => availableModels.map(toModelOption),
    [availableModels],
  );
  const roleOptions = useMemo<SelectOption[]>(
    () => availableRoles.map(toRoleOption),
    [availableRoles],
  );
  const isDirty = useMemo(() => {
    return (
      JSON.stringify(normalizeIds(draft.allowedRoleIds)) !==
        JSON.stringify(normalizeIds(params.allowedRoleIds)) ||
      JSON.stringify(normalizeIds(draft.allowedModelIds)) !==
        JSON.stringify(normalizeIds(params.allowedModelIds))
    );
  }, [draft.allowedModelIds, draft.allowedRoleIds, params.allowedModelIds, params.allowedRoleIds]);

  async function handleSave() {
    if (!canEditSchema) {
      ctx.alert('Your role cannot update plugin settings.');
      return;
    }

    setIsSaving(true);

    try {
      await ctx.updatePluginParameters(toPayload(draft));
      ctx.notice('Workbench settings saved.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Canvas ctx={ctx}>
      <div className={s.container}>
                  <p className={s.instructions}>
            Limit which roles can open the workbench and which models it can edit.
            Leave either field empty to rely on DatoCMS permissions only.
          </p>
          <FieldGroup>
            <SelectField
              name="allowedRoleIds"
              id="allowedRoleIds"
              label="Allowed roles"
              hint="Only these roles can open the workbench when at least one role is selected"
              value={selectedOptions(draft.allowedRoleIds, roleOptions)}
              selectInputProps={{
                isMulti: true,
                options: roleOptions,
                isDisabled: isLoadingOptions,
              }}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  allowedRoleIds: toOptionArray(value).map((option) => option.value),
                }))
              }
            />
            <SelectField
              name="allowedModelIds"
              id="allowedModelIds"
              label="Allowed models"
              hint="Only these models can be edited when at least one model is selected"
              value={selectedOptions(draft.allowedModelIds, modelOptions)}
              selectInputProps={{
                isMulti: true,
                options: modelOptions,
                isDisabled: isLoadingOptions,
              }}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  allowedModelIds: toOptionArray(value).map((option) => option.value),
                }))
              }
            />
          </FieldGroup>
          {isLoadingOptions && (
            <div className={s.notice}>
              <Spinner size={24} />
            </div>
          )}
          {loadError && <p className={s.notice}>{loadError}</p>}
          <div className={s.actions}>
            <Button
              fullWidth
              buttonType="primary"
              onClick={handleSave}
              disabled={!isDirty || isSaving || !canEditSchema}
            >
              {isSaving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
          {!canEditSchema && (
            <p className={s.notice}>
              Your role can use the workbench if allowed, but cannot change plugin
              settings.
            </p>
          )}
      </div>
    </Canvas>
  );
}
