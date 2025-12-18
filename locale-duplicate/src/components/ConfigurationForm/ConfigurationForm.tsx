import { 
  Form, 
  Section, 
  FieldGroup, 
  SelectField,
  SwitchField, 
  Button 
} from 'datocms-react-ui';
import { useMemo } from 'react';
import styles from './ConfigurationForm.module.css';
import { ModelOption } from '../../types';

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
  onSubmit
}: ConfigurationFormProps) {
  // Memoize locale options for source locale
  const sourceLocaleOptions = useMemo(() => 
    currentSiteLocales.map((locale) => ({
      label: getLocaleLabel(locale),
      value: locale,
    })),
    [currentSiteLocales, getLocaleLabel]
  );

  // Memoize locale options for target locale (excluding source)
  const targetLocaleOptions = useMemo(() => 
    currentSiteLocales
      .filter((l) => l !== sourceLocale)
      .map((locale) => ({
        label: getLocaleLabel(locale),
        value: locale,
      })),
    [currentSiteLocales, sourceLocale, getLocaleLabel]
  );

  // Memoize source locale value
  const sourceLocaleValue = useMemo(() => [
    {
      label: getLocaleLabel(sourceLocale),
      value: sourceLocale,
    },
  ], [sourceLocale, getLocaleLabel]);

  // Memoize target locale value
  const targetLocaleValue = useMemo(() => [
    {
      label: getLocaleLabel(targetLocale),
      value: targetLocale,
    },
  ], [targetLocale, getLocaleLabel]);

  return (
    <div className={styles.formWrapper}>
      <Form className={styles.formContainer}>
        <Section title="Mass Locale Duplication">
          {/* Explanation and warnings */}
          <div className={styles.explanationBox}>
            <p className={styles.explanationText}>
              This feature allows you to duplicate all content from one locale to another across multiple models in bulk. 
              It's useful for setting up new locales or creating baseline translations.
            </p>
            <div className={styles.warningBox}>
              <p className={styles.warningHeader}>
                <span className={styles.warningIcon}>⚠️</span>
                Warning
              </p>
              <ul className={styles.warningList}>
                <li>
                  This operation will <strong>overwrite all existing content</strong> in the target locale
                </li>
                <li>
                  The process cannot be undone automatically
                </li>
                <li>
                  Make sure to backup important content before proceeding
                </li>
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
                Choose which models should have their content duplicated from {getLocaleLabel(sourceLocale)} to {getLocaleLabel(targetLocale)}
              </p>
              
              <SelectField
                name="models"
                id="models"
                label=""
                value={selectedModels}
                selectInputProps={{
                  isMulti: true,
                  options: allModels,
                  placeholder: "Select models...",
                }}
                onChange={(newValue) => {
                  onModelsChange(newValue as ModelOption[]);
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
            disabled={selectedModels.length === 0}
            onClick={onSubmit}
          >
            Duplicate locale content
          </Button>
        </Section>
      </Form>
    </div>
  );
}