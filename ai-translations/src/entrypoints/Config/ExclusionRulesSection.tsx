/**
 * ExclusionRulesSection.tsx
 * Configuration component for exclusion rules settings.
 */

import { SelectField, SwitchField } from 'datocms-react-ui';
import s from '../styles.module.css';

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
  listOfFields: Field[];
}

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
  listOfFields,
}: ExclusionRulesSectionProps) {
  return (
    <>
      <div className={s.switchField} style={{ position: 'relative' }}>
        <SwitchField
          name="showExclusionRules"
          id="showExclusionRules"
          label="Show exclusion rules"
          value={showExclusionRules}
          onChange={(newValue) => setShowExclusionRules(newValue)}
        />
        {hasExclusionRules && (
          <div className={s.warningTooltip}>
            ⓘ
            <div className={s.tooltipText}>
              There are exclusion rules present. If the plugin is not being
              displayed in a model or field where you expect it, please review
              them.
            </div>
          </div>
        )}
      </div>

      {showExclusionRules && (
        <div className={s.exclusionRules}>
          <div style={{ marginTop: '16px' }}>
            <SelectField
              name="modelsToBeExcludedFromTranslation"
              id="modelsToBeExcludedFromTranslation"
              label="Models to be excluded from this plugin"
              value={modelsToBeExcluded.map((modelKey) => {
                const model = availableModels.find(
                  (m) => m.apiKey === modelKey
                );
                return {
                  label: model?.name ?? modelKey,
                  value: modelKey,
                };
              })}
              selectInputProps={{
                isMulti: true,
                options: availableModels.map((model) => ({
                  label: model.name ?? '',
                  value: model.apiKey ?? '',
                })),
              }}
              onChange={(newValue) => {
                const selectedModels = newValue.map((v) => v.value);
                setModelsToBeExcluded(selectedModels);
              }}
            />
          </div>

          <div style={{ marginTop: '16px' }}>
            <SelectField
              name="rolesToBeExcludedFromTranslation"
              id="rolesToBeExcludedFromTranslation"
              label="Roles to be excluded from using this plugin"
              value={rolesToBeExcluded.map((roleId) => {
                const role = roles.find((r) => r.id === roleId);
                return {
                  label: role?.name ?? roleId,
                  value: roleId,
                };
              })}
              selectInputProps={{
                isMulti: true,
                options: roles.map((role) => ({
                  label: role.name ?? '',
                  value: role.id ?? '',
                })),
              }}
              onChange={(newValue) => {
                const selectedRoles = newValue.map((v) => v.value);
                setRolesToBeExcluded(selectedRoles);
              }}
            />
          </div>

          <div style={{ marginTop: '16px' }}>
            <SelectField
              name="apiKeysToBeExcludedFromTranslation"
              id="apiKeysToBeExcludedFromTranslation"
              label="Field API keys to be excluded from using this plugin"
              value={apiKeysToBeExcluded.map((apiKey) => ({
                label: `${
                  listOfFields.find((field) => field.id === apiKey)?.name
                } (${
                  listOfFields.find((field) => field.id === apiKey)?.model
                })`,
                value: apiKey,
              }))}
              selectInputProps={{
                isMulti: true,
                options: listOfFields.map((field) => ({
                  label: `${field.name} (${field.model})`,
                  value: field.id,
                })),
              }}
              onChange={(newValue) => {
                const selectedApiKeys = newValue.map((v) => v.value);
                setApiKeysToBeExcluded(selectedApiKeys);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}


