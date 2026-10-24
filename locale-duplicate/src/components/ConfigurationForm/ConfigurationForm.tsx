import Callout from 'datocms-react-ui/Callout';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import Pane from 'datocms-react-ui/Pane';
import SelectInput from 'datocms-react-ui/SelectInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import SwitchList from 'datocms-react-ui/SwitchList';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useMemo, useState } from 'react';
import type { ModelOption } from '../../types';
import type { Formatters } from '../../utils/format';
import {
  getLargeSelectionHint,
  getVisibleOptions,
  LARGE_SELECTION_THRESHOLD,
} from '../../utils/selection';
import { pageTitle } from '../pageTitle';

export type ModelsState = 'loading' | 'loaded' | 'failed';

/** Why Duplicate can't run yet, or undefined when it can */
export function duplicateDisabledReason({
  sourceLocale,
  targetLocale,
  siteLocales,
  selectedCount,
  modelsState,
}: {
  sourceLocale: string;
  targetLocale: string;
  siteLocales: string[];
  selectedCount: number;
  modelsState: ModelsState;
}): string | undefined {
  if (siteLocales.length < 2) return 'The project has only one locale.';
  if (
    sourceLocale === targetLocale ||
    !siteLocales.includes(sourceLocale) ||
    !siteLocales.includes(targetLocale)
  ) {
    return 'Pick two different locales.';
  }
  if (modelsState === 'loading') return 'Wait for the models to load.';
  if (modelsState === 'failed') return "The models couldn't load.";
  if (selectedCount === 0) return 'Pick at least one model.';
}

interface ConfigurationFormProps {
  sourceLocale: string;
  targetLocale: string;
  currentSiteLocales: string[];
  selectedModels: ModelOption[];
  allModels: ModelOption[];
  modelsState: ModelsState;
  modelsError: string;
  useDraftRecords: boolean;
  publishAfterDuplication: boolean;
  format: Formatters;
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
  modelsState,
  modelsError,
  useDraftRecords,
  publishAfterDuplication,
  format,
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
    () => selectedModels.map((model) => model.value),
    [selectedModels],
  );
  const modelsById = useMemo(
    () => new Map(allModels.map((model) => [model.value, model])),
    [allModels],
  );
  const visibleModels = useMemo(
    () =>
      getVisibleOptions(
        allModels,
        modelSearch,
        compactSelection ? undefined : new Set(selectedModelIds),
      ),
    [allModels, modelSearch, selectedModelIds, compactSelection],
  );
  const sourceLocaleOptions = useMemo(
    () =>
      currentSiteLocales.map((locale) => ({
        label: getLocaleLabel(locale),
        value: locale,
      })),
    [currentSiteLocales, getLocaleLabel],
  );
  const targetLocaleOptions = useMemo(
    () => sourceLocaleOptions.filter((option) => option.value !== sourceLocale),
    [sourceLocaleOptions, sourceLocale],
  );
  const disabledReason = duplicateDisabledReason({
    sourceLocale,
    targetLocale,
    siteLocales: currentSiteLocales,
    selectedCount: selectedModels.length,
    modelsState,
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Pane
        header={
          <Pane.Header>
            {pageTitle}
            <Pane.Header.Button>
              <Toolbar.Button
                tone="alert"
                submit
                label="Duplicate"
                disabled={
                  disabledReason ? { reason: disabledReason } : undefined
                }
              />
            </Pane.Header.Button>
          </Pane.Header>
        }
      >
        <Page variant="large">
          <Page.Content>
            <Callout tone="warning" title="The target locale gets overwritten">
              Duplication replaces the content of the target locale in every
              selected record, and it can't be undone. Back up important content
              first.
            </Callout>
            <Page.Group title="Locales">
              <div className="form__field form__row">
                <div className="form__row__cell">
                  <FieldWrapper
                    label="Source locale"
                    hint="The locale to copy the content from."
                  >
                    <SelectInput
                      value={sourceLocale}
                      options={sourceLocaleOptions}
                      clearable={false}
                      onChange={(value) =>
                        onSourceLocaleChange(value || sourceLocale)
                      }
                    />
                  </FieldWrapper>
                </div>
                <div className="form__row__cell">
                  <FieldWrapper
                    label="Target locale"
                    hint="The locale whose content is replaced."
                  >
                    <SelectInput
                      value={targetLocale}
                      options={targetLocaleOptions}
                      clearable={false}
                      // The target can equal the new source, which the
                      // options leave out
                      acceptValueNotIncludedInOptions={(value) => ({
                        value,
                        label: getLocaleLabel(value),
                      })}
                      onChange={(value) =>
                        onTargetLocaleChange(value || targetLocale)
                      }
                    />
                  </FieldWrapper>
                </div>
              </div>
            </Page.Group>
            <Page.Group title="Models">
              <FieldWrapper
                label="Models"
                labelExtras={{ hidden: true }}
                hint={
                  getLargeSelectionHint(allModels.length, 'models') ??
                  `The records of these models get the ${getLocaleLabel(sourceLocale)} content in ${getLocaleLabel(targetLocale)}.`
                }
                error={
                  modelsState === 'failed'
                    ? `Couldn't load the models: ${modelsError}`
                    : undefined
                }
              >
                <SelectInput
                  multiple
                  clearable
                  loading={modelsState === 'loading'}
                  value={selectedModelIds}
                  options={visibleModels}
                  // The visible options are capped and leave out the selected
                  // models: the selection keeps the ones they don't hold
                  acceptValueNotIncludedInOptions={(id) => modelsById.get(id)}
                  onChange={(_ids, options) => onModelsChange(options)}
                  search={
                    allModels.length > LARGE_SELECTION_THRESHOLD
                      ? { onQueryChange: setModelSearch }
                      : undefined
                  }
                  {...(compactSelection
                    ? {
                        controlShouldRenderValue: false,
                        hideSelectedOptions: false,
                        placeholder: `${format.models(selectedModels.length)} selected`,
                      }
                    : {})}
                />
              </FieldWrapper>
            </Page.Group>
            <Page.Group title="Records">
              <SwitchList>
                <FieldWrapper hint="When off, only published records are duplicated, from their published content.">
                  <SwitchInput
                    label="Include draft records"
                    value={useDraftRecords}
                    onChange={(value) =>
                      onUseDraftRecordsChange(Boolean(value))
                    }
                  />
                </FieldWrapper>
                <FieldWrapper hint="Publishes each record that is duplicated successfully. When off, the changes stay in draft.">
                  <SwitchInput
                    label="Publish records after duplication"
                    value={publishAfterDuplication}
                    onChange={(value) =>
                      onPublishAfterDuplicationChange(Boolean(value))
                    }
                  />
                </FieldWrapper>
              </SwitchList>
            </Page.Group>
          </Page.Content>
        </Page>
      </Pane>
    </form>
  );
}
