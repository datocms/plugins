import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas, SelectField, Button, Spinner } from 'datocms-react-ui';
import { useEffect, useState } from 'react';
import { buildDatoCMSClient } from '../../utils/clients';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { isProviderConfigured } from '../../utils/translation/ProviderFactory';
import s from './AIBulkTranslationsPage.module.css';
// Light local equivalents of react-select types to avoid adding the package
type SingleValue<T> = T | null;
type MultiValue<T> = readonly T[];

type PropTypes = {
  ctx: RenderPageCtx;
};

type ModelOption = {
  label: string;
  value: string;
};

type LocaleOption = {
  label: string;
  value: string;
};

interface TranslationModalResult {
  completed?: boolean;
  canceled?: boolean;
}

export default function AIBulkTranslationsPage({ ctx }: PropTypes) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<ModelOption[]>([]);
  const [locales, setLocales] = useState<LocaleOption[]>([]);
  const [sourceLocale, setSourceLocale] = useState<LocaleOption | null>(null);
  const [targetLocale, setTargetLocale] = useState<LocaleOption | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!ctx.currentUserAccessToken) {
        ctx.alert('No access token found');
        setIsLoading(false);
        return;
      }

      try {
        const client = buildDatoCMSClient(ctx.currentUserAccessToken, ctx.environment);
        
        const itemTypes = await client.itemTypes.list() 

        const nonBlockModels = itemTypes.filter(model => 
          !model.modular_block
        );
        
        const modelOptions = nonBlockModels.map(model => ({
          label: model.name,
          value: model.id
        }));
        
        setModels(modelOptions);
        
        const site = await client.site.find() 
        const localeOptions = site.locales.map((locale: string) => ({
          label: locale,
          value: locale
        }));
        
        setLocales(localeOptions);
        
        if (localeOptions.length > 0) {
          setSourceLocale(localeOptions[0]);
        }
        
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading data:', error);
        ctx.alert(`Error loading data: ${error instanceof Error ? error.message : String(error)}`);
        setIsLoading(false);
      }
    }
    
    loadData();
  }, [ctx]);

  const startTranslation = async () => {
    if (!sourceLocale || !targetLocale || selectedModels.length === 0) {
      ctx.alert('Please select source locale, target locale, and at least one model');
      return;
    }
    
    if (sourceLocale.value === targetLocale.value) {
      ctx.alert('Source and target locales must be different');
      return;
    }

    if (!ctx.currentUserAccessToken) {
      ctx.alert('No access token found');
      return;
    }
    
    const pluginParams = ctx.plugin.attributes.parameters as ctxParamsType;
    if (!isProviderConfigured(pluginParams)) {
      ctx.alert('Please configure valid credentials for the selected AI vendor in the plugin settings');
      return;
    }

    try {
      const client = buildDatoCMSClient(ctx.currentUserAccessToken, ctx.environment);
      const allRecordIds: string[] = [];
      
      setIsLoading(true);
      
      for (const model of selectedModels) {
        const recordsIterator = client.items.listPagedIterator({
          filter: {
            type: model.value,
          },
          version: 'current',
          nested: true
        });
        
        for await (const record of recordsIterator) {
          allRecordIds.push(record.id);
        }
      }
      
      setIsLoading(false);
      
      if (allRecordIds.length === 0) {
        ctx.alert('No records found in the selected models');
        return;
      }
      
      const modalPromise = ctx.openModal({
        id: 'translationProgressModal',
        title: 'Translation Progress',
        width: 'l',
        parameters: {
          totalRecords: allRecordIds.length,
          fromLocale: sourceLocale.value,
          toLocale: targetLocale.value,
          accessToken: ctx.currentUserAccessToken,
          pluginParams,
          itemIds: allRecordIds
        }
      });
      
      try {
        const result = await modalPromise as TranslationModalResult;
        
        if (result?.completed) {
          ctx.notice(`Successfully translated ${allRecordIds.length} record(s) from ${sourceLocale.value} to ${targetLocale.value}`);
        } else if (result?.canceled) {
          ctx.notice(`Translation from ${sourceLocale.value} to ${targetLocale.value} was canceled`);
        }
      } catch (error) {
        ctx.alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      setIsLoading(false);
      ctx.alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleSourceLocaleChange = (newValue: SingleValue<LocaleOption> | MultiValue<LocaleOption>) => {
    if (newValue && !Array.isArray(newValue)) {
      setSourceLocale(newValue as LocaleOption);
    }
  };

  const handleTargetLocaleChange = (newValue: SingleValue<LocaleOption> | MultiValue<LocaleOption>) => {
    if (newValue && !Array.isArray(newValue)) {
      setTargetLocale(newValue as LocaleOption);
    }
  };

  const handleModelChange = (newValue: SingleValue<ModelOption> | MultiValue<ModelOption>) => {
    if (Array.isArray(newValue)) {
      setSelectedModels([...newValue]);
    }
  };

  return (
    <Canvas ctx={ctx}>
      <div className={s.page}>
        <div className={s.container}>
          <div className={s.card}>
            <div className={s.cardHeader}>
              <h1 className={s.cardTitle}>AI Bulk Translations</h1>
              <p className={s.cardCaption}>Select languages and models to perform bulk translations.</p>
            </div>

            {/* Loading overlay */}
            {isLoading && (
              <div className={s.loadingOverlay}>
                <Spinner size={40} />
                <div className={s.loadingText}>Loading languages and models...</div>
              </div>
            )}

            {/* Language selectors row */}
            <div className={s.section}>
              <div className={s.localeRow}>
                <div>
                  <SelectField
                    name="sourceLocale"
                    id="sourceLocale"
                    label="Source Language"
                    hint="Translate from"
                    value={sourceLocale}
                    selectInputProps={{ options: locales }}
                    onChange={handleSourceLocaleChange}
                  />
                </div>
                <div className={s.localeArrow} aria-hidden>
                  →
                </div>
                <div>
                  <SelectField
                    name="targetLocale"
                    id="targetLocale"
                    label="Target Language"
                    hint="Translate to"
                    value={targetLocale}
                    selectInputProps={{
                      options: locales.filter((locale) => locale.value !== sourceLocale?.value),
                    }}
                    onChange={handleTargetLocaleChange}
                  />
                </div>
              </div>
            </div>

            {/* Models selector */}
            <div className={s.section}>
              <SelectField
                name="selectedModels"
                id="selectedModels"
                label="Models to Translate"
                hint="Select one or more models to translate"
                value={selectedModels}
                selectInputProps={{ isMulti: true, options: models }}
                onChange={handleModelChange}
              />
              {selectedModels.length > 0 && (
                <div className={s.helperText}>
                  Selected {selectedModels.length} {selectedModels.length === 1 ? 'model' : 'models'}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className={s.actions}>
              <Button
                buttonType="primary"
                onClick={startTranslation}
                disabled={!sourceLocale || !targetLocale || selectedModels.length === 0}
                fullWidth
              >
                Start Bulk Translation
              </Button>

              {sourceLocale && targetLocale && selectedModels.length > 0 && (
                <div className={`${s.helperText} ${s.statusReady}`}>
                  Ready to translate from {sourceLocale.label} to {targetLocale.label}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className={s.footerNote}>
          Translations are performed using AI. Review content after translation.
        </div>
      </div>
    </Canvas>
  );
}
/**
 * AIBulkTranslationsPage.tsx
 * Custom settings page that lets admins run bulk translations across models.
 * Uses the CMA client from the current user token and opens a modal to track progress.
 * This page is only visible to users with schema permissions (see main.tsx settings menu).
 */
