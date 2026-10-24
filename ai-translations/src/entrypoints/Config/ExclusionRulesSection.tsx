/**
 * ExclusionRulesSection.tsx
 * The "Exclusions" group of the config screen: the models, roles and fields
 * where the plugin doesn't show. The group opens and closes; it is open at
 * first when some exclusion exists.
 */

import Callout from 'datocms-react-ui/Callout';
import { useCtx } from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import Pill from 'datocms-react-ui/Pill';
import SelectInput from 'datocms-react-ui/SelectInput';
import { useMemo } from 'react';
import { formatCount } from '../../components/BulkTranslations/bulkCopy';
import {
  type ChipOption,
  formatApiKeyOptionLabel,
} from '../../components/BulkTranslations/chipOption';

export interface AvailableModel {
  apiKey?: string;
  name?: string;
  isBlock?: boolean;
}

export interface Role {
  id: string;
  name: string;
}

export interface Field {
  id: string;
  name: string;
  model: string;
}

/** The state of the request that loads the roles of the project. */
export type RolesStatus = 'loading' | 'ready' | 'error';

export interface ExclusionRulesSectionProps {
  showExclusionRules: boolean;
  setShowExclusionRules: (value: boolean) => void;
  hasExclusionRules: boolean;
  modelsToBeExcluded: string[];
  setModelsToBeExcluded: (value: string[]) => void;
  rolesToBeExcluded: string[];
  setRolesToBeExcluded: (value: string[]) => void;
  apiKeysToBeExcluded: string[];
  setApiKeysToBeExcluded: (value: string[]) => void;
  availableModels: AvailableModel[];
  roles: Role[];
  /** The roles request; `ready` when not given. */
  rolesStatus?: RolesStatus;
  listOfFields: Field[];
  /** The fields of the schema are still loading; `false` when not given. */
  fieldsLoading?: boolean;
}

/**
 * A saved value that no option has (a deleted model or role, a field saved by
 * API key or path) shows as the raw token, and is saved unchanged. Each
 * select lists every option of the schema, so the whole list can be
 * scrolled as well as searched.
 */
function savedTokenOption(value: string): ChipOption {
  return { label: value, value };
}

const noModels = () => 'No models';
const noRoles = () => 'No roles';
const noFields = () => 'No fields';

export default function ExclusionRulesSection({
  showExclusionRules,
  setShowExclusionRules,
  hasExclusionRules,
  modelsToBeExcluded,
  setModelsToBeExcluded,
  rolesToBeExcluded,
  setRolesToBeExcluded,
  apiKeysToBeExcluded,
  setApiKeysToBeExcluded,
  availableModels,
  roles,
  rolesStatus = 'ready',
  listOfFields,
  fieldsLoading = false,
}: ExclusionRulesSectionProps) {
  // Counts get the separators of the language that the Canvas gives the kit.
  const { locale } = useCtx().ui;
  const modelOptions = useMemo<ChipOption[]>(
    () =>
      availableModels.flatMap((model) =>
        model.apiKey
          ? [
              {
                label: model.name ?? model.apiKey,
                value: model.apiKey,
                code: model.apiKey,
              },
            ]
          : [],
      ),
    [availableModels],
  );

  const roleOptions = useMemo<ChipOption[]>(
    () =>
      roles.map((role) => ({ label: role.name || role.id, value: role.id })),
    [roles],
  );

  const fieldOptions = useMemo<ChipOption[]>(
    () =>
      listOfFields.map((field) => ({
        label: `${field.name} (${field.model})`,
        value: field.id,
      })),
    [listOfFields],
  );

  // The header keeps saying that exclusions exist while the group is closed.
  const exclusionCount =
    modelsToBeExcluded.length +
    rolesToBeExcluded.length +
    apiKeysToBeExcluded.length;

  return (
    <Page.Group
      title="Exclusions"
      status={
        exclusionCount > 0 ? (
          <Pill>
            {`${formatCount(exclusionCount, locale)} ${
              exclusionCount === 1 ? 'exclusion' : 'exclusions'
            }`}
          </Pill>
        ) : undefined
      }
      collapse={{
        open: showExclusionRules,
        onToggle: () => setShowExclusionRules(!showExclusionRules),
      }}
    >
      {hasExclusionRules && (
        <Callout>
          Some models, roles or fields are excluded, so the plugin doesn't show
          everywhere.
        </Callout>
      )}
      <FieldWrapper
        label="Excluded models"
        hint="The plugin doesn't translate the records of these models."
      >
        <SelectInput
          multiple
          name="modelsToBeExcludedFromTranslation"
          value={modelsToBeExcluded}
          onChange={(value) => setModelsToBeExcluded(value ?? [])}
          options={modelOptions}
          acceptValueNotIncludedInOptions={savedTokenOption}
          formatOptionLabel={formatApiKeyOptionLabel}
          noOptionsMessage={noModels}
          placeholder="Pick models"
        />
      </FieldWrapper>
      <FieldWrapper
        label="Excluded roles"
        hint="Users with these roles can't use the plugin."
        error={rolesStatus === 'error' ? "Couldn't load the roles." : undefined}
      >
        <SelectInput
          multiple
          name="rolesToBeExcludedFromTranslation"
          value={rolesToBeExcluded}
          onChange={(value) => setRolesToBeExcluded(value ?? [])}
          options={roleOptions}
          loading={rolesStatus === 'loading'}
          acceptValueNotIncludedInOptions={savedTokenOption}
          noOptionsMessage={noRoles}
          placeholder="Pick roles"
        />
      </FieldWrapper>
      <FieldWrapper
        label="Excluded fields"
        hint="The plugin never translates these fields."
      >
        <SelectInput
          multiple
          name="apiKeysToBeExcludedFromTranslation"
          value={apiKeysToBeExcluded}
          onChange={(value) => setApiKeysToBeExcluded(value ?? [])}
          options={fieldOptions}
          acceptValueNotIncludedInOptions={savedTokenOption}
          loading={fieldsLoading}
          noOptionsMessage={noFields}
          placeholder="Pick fields"
        />
      </FieldWrapper>
    </Page.Group>
  );
}
