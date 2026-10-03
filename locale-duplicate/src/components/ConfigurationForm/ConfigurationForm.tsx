import {
  Button,
  FieldGroup,
  Form,
  Section,
  SelectField,
  SwitchField,
} from 'datocms-react-ui';
import { useMemo, useState } from 'react';
import type { ModelOption } from '../../types';
import {
  getLargeSelectionHint,
  getVisibleOptions,
  LARGE_SELECTION_THRESHOLD,
} from '../../utils/selection';
import styles from './ConfigurationForm.module.css';

interface ConfigurationFormProps {
  sourceLocale: string;
  targetLocale: string;
  currentSiteLocales: string[];
  selectedModels: ModelOption[];
  allModels: ModelOption[];
  useDraftRecords: boolean;
  publishAfterDuplication: boolean;
  getLocaleLabel: (locale: string) => string;
  onSourceLocaleChange: (locale: string) => void;
  onTargetLocaleChange: (locale: string) => void;
  onModelsChange: (models: ModelOption[]) => void;
  onUseDraftRecordsChange: (value: boolean) => void;
  onPublishAfterDuplicationChange: (value: boolean) => void;
  onSubmit: () => void;
}

export function ConfigurationForm({
  sourceLocale,
  targetLocale,
  currentSiteLocales,
  selectedModels,
  allModels,
  useDraftRecords,
  publishAfterDuplication,
  getLocaleLabel,
  onSourceLocaleChange,
  onTargetLocaleChange,
  onModelsChange,
  onUseDraftRecordsChange,
  onPublishAfterDuplicationChange,
  onSubmit,
}: ConfigurationFormProps) {
  const [modelSearch, setModelSearch] = useState('');
  const compactSelection = selectedModels.length > 50;
  const selectedModelIds = useMemo(
    () => new Set(selectedModels.map((model) => model.value)),
    [selectedModels],
  );
  const visibleModels = useMemo(
    () =>
      getVisibleOptions(
        allModels,
        modelSearch,
        compactSelection ? undefined : selectedModelIds,
      ),
    [allModels, modelSearch, selectedModelIds, compactSelection],
  );
  // Memoize locale options for source locale
  const sourceLocaleOptions = useMemo(
    () =>
      currentSiteLocales.map((locale) => ({
        label: getLocaleLabel(locale),
        value: locale,
      })),
    [currentSiteLocales, getLocaleLabel],
  );

  // Memoize locale options for target locale (excluding source)
  const targetLocaleOptions = useMemo(
    () => sourceLocaleOptions.filter((option) => option.value !== sourceLocale),
    [sourceLocaleOptions, sourceLocale],
  );

  // Memoize source locale value
  const sourceLocaleValue = useMemo(
    () => [
      {
        label: getLocaleLabel(sourceLocale),
        value: sourceLocale,
      },
    ],
    [sourceLocale, getLocaleLabel],
  );

  // Memoize target locale value
  const targetLocaleValue = useMemo(
    () => [
      {
        label: getLocaleLabel(targetLocale),
        value: targetLocale,
      },
    ],
    [targetLocale, getLocaleLabel],
  );

  return (
    <div className={styles.formWrapper}>
      <Form className={styles.formContainer}>
        <Section title="Mass Locale Duplication">
          {/* Explanation and warnings */}
          <div className={styles.explanationBox}>
            <p className={styles.explanationText}>
              This feature allows you to duplicate all content from one locale
              to another across multiple models in bulk. It's useful for setting
              up new locales or creating baseline translations.
            </p>
            <div className={styles.warningBox}>
              <p className={styles.warningHeader}>
                <span className={styles.warningIcon}>⚠️</span>
                Warning
              </p>
              <ul className={styles.warningList}>
                <li>
                  This operation will{' '}
                  <strong>overwrite all existing content</strong> in the target
                  locale
                </li>
                <li>The process cannot be undone automatically</li>
                <li>Make sure to backup important content before proceeding</li>
              </ul>
            </div>
          </div>

          <FieldGroup>
            {/* Locale selection interface - side by side layout */}
            <div className={styles.localeSelection}>
              <div className={styles.localeField}>
                <SelectField
                  name="fromLocale"
                  id="fromLocale"
                  label="Source Locale"
                  hint="Select the locale you want to copy content from"
                  value={sourceLocaleValue}
                  selectInputProps={{
                    isMulti: false,
                    options: sourceLocaleOptions,
                  }}
                  onChange={(newValue) => {
                    const newSourceLocale = newValue?.value || sourceLocale;
                    onSourceLocaleChange(newSourceLocale);
                  }}
                />
              </div>

              <div className={styles.localeField}>
                <SelectField
                  name="toLocales"
                  id="toLocales"
                  label="Target Locale"
                  hint="Select the locale you want to copy content to"
                  value={targetLocaleValue}
                  selectInputProps={{
                    isMulti: false,
                    options: targetLocaleOptions,
                  }}
                  onChange={(newValue) => {
                    const newTargetLocale = newValue?.value || targetLocale;
                    onTargetLocaleChange(newTargetLocale);
                  }}
                />
              </div>
            </div>
          </FieldGroup>

          <FieldGroup>
            <div className={styles.modelSelectionContainer}>
              <h3 className={styles.modelSelectionHeader}>
                Select Models to Duplicate
              </h3>
              <p className={styles.modelSelectionDescription}>
                Choose which models should have their content duplicated from{' '}
                {getLocaleLabel(sourceLocale)} to {getLocaleLabel(targetLocale)}
              </p>

              <SelectField
                name="models"
                id="models"
                label=""
                hint={getLargeSelectionHint(allModels.length, 'models')}
                placeholder={
                  compactSelection
                    ? `${selectedModels.length} models selected...`
                    : undefined
                }
                value={selectedModels}
                selectInputProps={{
                  isMulti: true,
                  options: visibleModels,
                  placeholder: compactSelection
                    ? `${selectedModels.length} models selected...`
                    : 'Select models...',
                  ...(compactSelection
                    ? {
                        controlShouldRenderValue: false,
                        hideSelectedOptions: false,
                      }
                    : {}),
                  onInputChange: setModelSearch,
                  ...(allModels.length > LARGE_SELECTION_THRESHOLD
                    ? { filterOption: null }
                    : {}),
                }}
                onChange={(newValue) => {
                  onModelsChange(Array.isArray(newValue) ? newValue : []);
                }}
              />
            </div>
          </FieldGroup>

          <FieldGroup>
            <div className={styles.switchFieldsContainer}>
              <div className={styles.switchFieldWrapper}>
                <SwitchField
                  name="useDraftRecords"
                  id="useDraftRecords"
                  label="Use records in draft state"
                  hint="Include draft records when duplicating content. If disabled, only published records will be duplicated."
                  value={useDraftRecords}
                  onChange={onUseDraftRecordsChange}
                />
              </div>

              <div className={styles.switchFieldWrapper}>
                <SwitchField
                  name="publishAfterDuplication"
                  id="publishAfterDuplication"
                  label="Publish updated records automatically after duplication"
                  hint="Automatically publish all successfully duplicated records. If disabled, duplicated content will remain in draft state."
                  value={publishAfterDuplication}
                  onChange={onPublishAfterDuplicationChange}
                />
              </div>
            </div>
          </FieldGroup>

          {/* Submit button */}
          <Button
            fullWidth
            buttonType="primary"
            buttonSize="l"
            disabled={
              selectedModels.length === 0 ||
              sourceLocale === targetLocale ||
              !currentSiteLocales.includes(sourceLocale) ||
              !currentSiteLocales.includes(targetLocale)
            }
            onClick={onSubmit}
          >
            Duplicate locale content
          </Button>
        </Section>
      </Form>
    </div>
  );
}
