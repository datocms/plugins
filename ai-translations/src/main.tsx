/**
 * main.tsx
 * -------------------------------------------
 * This file connects the plugin to DatoCMS,
 * defines field dropdown actions, and triggers
 * the translation logic when actions are invoked.
 */

import type {
  DropdownAction,
  DropdownActionGroup,
  ExecuteFieldDropdownActionCtx,
  ExecuteItemsDropdownActionCtx,
  FieldDropdownActionsCtx,
  Item,
  ItemDropdownActionsCtx,
  ItemFormSidebarPanelsCtx,
  ItemType,
  RenderFieldExtensionCtx,
  RenderItemFormSidebarPanelCtx,
  RenderModalCtx,
  RenderPageCtx,
  SettingsAreaSidebarItemGroupsCtx,
} from 'datocms-plugin-sdk';
import { connect } from 'datocms-plugin-sdk';

import { Button, Canvas } from 'datocms-react-ui';

import 'datocms-react-ui/styles.css';
import AITranslationsPickerModal, {
  type AITranslationsPickerModalParams,
  type AITranslationsPickerModalResult,
} from './components/AITranslationsPickerModal';
import ErrorBoundary from './components/ErrorBoundary';
import TranslationConfirmModal, {
  type TranslationConfirmModalParams,
  isTranslationConfirmModalParams,
} from './components/TranslationConfirmModal';
import TranslationProgressModal from './components/TranslationProgressModal';
import ConfigScreen, {
  type ctxParamsType,
  isValidCtxParams,
} from './entrypoints/Config/ConfigScreen';
import {
  modularContentVariations,
  translateFieldTypes,
} from './entrypoints/Config/configConstants';
import AIBulkTranslationsPage from './entrypoints/CustomPage/AIBulkTranslationsPage';
import LoadingAddon from './entrypoints/LoadingAddon';
import TranslateSidebar from './entrypoints/Sidebar/TranslateSidebar';
import { defaultPrompt } from './prompts/DefaultPrompt';
import { createLogger } from './utils/logging/Logger';
import { formatLocaleWithCode } from './utils/localeUtils';
import { render } from './utils/render';
// Import refactored utility functions and types
import {
  formatErrorForUser,
  handleUIError,
  normalizeProviderError,
} from './utils/translation/ProviderErrors';
import {
  getProvider,
  isProviderConfigured,
} from './utils/translation/ProviderFactory';
import {
  isFieldExcluded,
  isFieldTranslatable,
} from './utils/translation/SharedFieldUtils';
import TranslateField from './utils/translation/TranslateField';
import type { QcFlag } from './utils/translation/qc/types';
import { isEmptyStructuredText } from './utils/translation/utils';

/**
 * Parameters passed to the TranslationProgressModal.
 * Shared interface between modal opener and renderer for type safety.
 * NOTE: Keep in sync with the interface inside TranslationProgressModal.tsx.
 */
interface TranslationProgressModalParams {
  totalRecords: number;
  fromLocale: string;
  /** Target locale keys (one or more). */
  toLocales: string[];
  accessToken: string;
  pluginParams: ctxParamsType;
  itemIds: string[];
  selectedFieldsByModel?: Record<string, string[]>;
}

type EnvironmentNavigationCtx = {
  environment: string;
  isEnvironmentPrimary: boolean;
  plugin: { id: string };
};

function buildPluginSettingsPath(ctx: EnvironmentNavigationCtx): string {
  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  return `${environmentPrefix}/configuration/plugins/${ctx.plugin.id}/edit`;
}

/**
 * Type guard for TranslationProgressModalParams.
 * Validates that modal parameters contain all required fields.
 *
 * @param params - The parameters to validate.
 * @returns True if params has all required TranslationProgressModalParams fields.
 */
function isTranslationProgressModalParams(
  params: unknown,
): params is TranslationProgressModalParams {
  if (!params || typeof params !== 'object') return false;
  const p = params as Record<string, unknown>;
  return (
    typeof p.totalRecords === 'number' &&
    typeof p.fromLocale === 'string' &&
    Array.isArray(p.toLocales) &&
    typeof p.accessToken === 'string' &&
    p.pluginParams !== undefined &&
    Array.isArray(p.itemIds)
  );
}

/**
 * Helper to extract plugin parameters from any DatoCMS context.
 *
 * Uses isValidCtxParams type guard to validate the shape at runtime.
 * Falls back to a cast if validation fails (which can happen on first boot
 * before defaults are applied by onBoot).
 *
 * @param ctx - Any DatoCMS context with plugin attributes.
 * @returns Typed plugin parameters.
 */
function getPluginParams(ctx: {
  plugin: { attributes: { parameters: unknown } };
}): ctxParamsType {
  const params = ctx.plugin.attributes.parameters;

  if (isValidCtxParams(params)) {
    return params;
  }

  // Fallback for unconfigured state (first boot, before onBoot applies defaults)
  // This is safe because onBoot() will apply defaults immediately after
  return params as ctxParamsType;
}


/**
 * Helper function to get nested values by dot/bracket notation
 * @param obj - object to traverse
 * @param path - dot/bracket string path
 */
function getValueAtPath(
  obj: Record<string, unknown> | unknown[],
  path: string,
): unknown {
  // Handle both dot and bracket notation
  const parts = path.replace(/\[([^\]]+)\]/g, '.$1').split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object'
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Determines whether the plugin should suppress dropdown actions for a field
 * based on model exclusion, role exclusion, field exclusion, and translatability.
 *
 * @param pluginParams - Plugin configuration parameters.
 * @param ctx - Field dropdown actions context.
 * @returns True if the field's dropdown should return an empty array.
 */
function isFieldDropdownSuppressed(
  pluginParams: ctxParamsType,
  ctx: FieldDropdownActionsCtx,
): boolean {
  const isModelExcluded =
    pluginParams.modelsToBeExcludedFromThisPlugin.includes(
      ctx.itemType.attributes.api_key,
    );
  const isRoleExcluded = pluginParams.rolesToBeExcludedFromThisPlugin.includes(
    ctx.currentRole.id,
  );
  const fieldExcluded = isFieldExcluded(
    pluginParams.apiKeysToBeExcludedFromThisPlugin,
    [ctx.field.id, ctx.field.attributes.api_key, ctx.fieldPath],
  );
  const fieldTranslatable = isFieldTranslatable(
    ctx.field.attributes.appearance.editor,
    pluginParams.translationFields,
    modularContentVariations,
  );
  return (
    isModelExcluded || isRoleExcluded || fieldExcluded || !fieldTranslatable
  );
}

/**
 * Resolves whether the current locale contains a non-empty translatable value
 * for the given field. Handles both direct values and locale-keyed objects.
 *
 * @param fieldType - The field editor type identifier.
 * @param fieldValue - The raw field value from form values.
 * @param locale - The current editing locale.
 * @returns True if the field has a non-empty value in the current locale.
 */
function resolveHasFieldValueInLocale(
  fieldType: string,
  fieldValue: unknown,
  locale: string,
): boolean {
  const isLocaleKeyedObject =
    fieldValue &&
    typeof fieldValue === 'object' &&
    !Array.isArray(fieldValue) &&
    locale in (fieldValue as Record<string, unknown>);

  if (isLocaleKeyedObject) {
    const fieldValueInThisLocale = (fieldValue as Record<string, unknown>)[
      locale
    ];
    const emptyStructuredText =
      fieldType === 'structured_text' &&
      isEmptyStructuredText(fieldValueInThisLocale);
    return !!fieldValueInThisLocale && !emptyStructuredText;
  }

  const emptyStructuredText =
    fieldType === 'structured_text' && isEmptyStructuredText(fieldValue);
  return !!fieldValue && !emptyStructuredText;
}

/**
 * Primary plugin connection point.
 */
/**
 * Surfaces collected QC flags from a single-field dropdown translation: a
 * blocking alert for hard errors (incomplete content) and a notice otherwise.
 */
function surfaceFieldQcFlags(
  ctx: ExecuteFieldDropdownActionCtx,
  flags: QcFlag[],
): void {
  if (flags.length === 0) return;
  const errorFlags = flags.filter((flag) => flag.severity === 'error');
  const summary = flags
    .slice(0, 8)
    .map((flag) => `• ${flag.message}`)
    .join('\n');
  if (errorFlags.length > 0) {
    // Count distinct fields, not flags: several per-locale flags on one field
    // must not read as several fields.
    const fieldCount = new Set(errorFlags.map((flag) => flag.fieldPath)).size;
    ctx.alert(
      `Translation finished, but ${fieldCount} field(s) may be incomplete — please review:\n${summary}`,
    );
  } else {
    ctx.notice(
      `Translation finished with ${flags.length} note(s) worth reviewing.`,
    );
  }
}

connect({
  onBoot(ctx) {
    const pluginParams = getPluginParams(ctx);

    // Collect all missing default values in a single object
    const defaults: Partial<ctxParamsType> = {};

    if (!pluginParams.vendor) {
      defaults.vendor = 'openai';
    }
    if (!pluginParams.translationFields) {
      defaults.translationFields = Object.keys(translateFieldTypes);
    }
    if (typeof pluginParams.translateWholeRecord === 'undefined') {
      defaults.translateWholeRecord = true;
    }
    if (!pluginParams.prompt) {
      defaults.prompt = defaultPrompt;
    }
    if (!pluginParams.modelsToBeExcludedFromThisPlugin) {
      defaults.modelsToBeExcludedFromThisPlugin = [];
    }
    if (!pluginParams.rolesToBeExcludedFromThisPlugin) {
      defaults.rolesToBeExcludedFromThisPlugin = [];
    }
    if (!pluginParams.apiKeysToBeExcludedFromThisPlugin) {
      defaults.apiKeysToBeExcludedFromThisPlugin = [];
    }
    if (!pluginParams.gptModel) {
      defaults.gptModel = 'gpt-5.4-mini';
    }

    // Apply all defaults in a single update call if any are needed
    if (Object.keys(defaults).length > 0) {
      ctx.updatePluginParameters({ ...pluginParams, ...defaults });
    }

    // Check if provider is configured after applying defaults
    const effectiveParams = { ...pluginParams, ...defaults };
    if (!isProviderConfigured(effectiveParams as ctxParamsType)) {
      ctx.alert(
        'Please configure credentials for the selected AI vendor in the settings page',
      );
    }
  },

  renderConfigScreen(ctx) {
    return render(
      <ErrorBoundary>
        <ConfigScreen ctx={ctx} />
      </ErrorBoundary>,
    );
  },

  // New hook to add a custom section in the Settings area
  settingsAreaSidebarItemGroups(ctx: SettingsAreaSidebarItemGroupsCtx) {
    // Only show to users who can edit schema
    if (!ctx.currentRole.attributes.can_edit_schema) {
      return [];
    }

    return [
      {
        label: 'AI Translations',
        items: [
          {
            label: 'Bulk Translations',
            icon: 'language',
            pointsTo: {
              pageId: 'ai-bulk-translations',
            },
          },
        ],
      },
    ];
  },

  // Update renderPage function to render our custom page
  renderPage(pageId: string, ctx: RenderPageCtx) {
    switch (pageId) {
      case 'ai-bulk-translations':
        return render(
          <ErrorBoundary
            onNavigateToSettings={() =>
              ctx.navigateTo(buildPluginSettingsPath(ctx))
            }
          >
            <AIBulkTranslationsPage ctx={ctx} />
          </ErrorBoundary>,
        );
      default:
        return null;
    }
  },

  itemsDropdownActions(_itemType: ItemType, ctx: ItemDropdownActionsCtx) {
    const pluginParams = getPluginParams(ctx);

    // Check for feature toggle and exclusion rules
    const isRoleExcluded =
      pluginParams.rolesToBeExcludedFromThisPlugin?.includes(
        ctx.currentRole.id,
      );
    const isModelExcluded =
      pluginParams.modelsToBeExcludedFromThisPlugin?.includes(
        _itemType.attributes.api_key,
      );

    // Return empty array if bulk translation is disabled or if role/model is excluded
    if (
      (typeof pluginParams.translateBulkRecords === 'boolean' &&
        !pluginParams.translateBulkRecords) ||
      isRoleExcluded ||
      isModelExcluded
    ) {
      return [];
    }

    // Single entry point — opens a picker modal where the user configures
    // source/target locales and per-model field selection in one place.
    // The plugin SDK's items-dropdown actions only support two visible
    // levels, so the "AI Translations → From → To" hierarchy is collapsed
    // into a modal-based picker instead.
    return [
      {
        id: 'aiTranslationsPicker',
        label: 'AI Translate these records',
        icon: 'language',
      },
    ];
  },

  async executeItemsDropdownAction(
    actionId: string,
    items: Item[],
    ctx: ExecuteItemsDropdownActionCtx,
  ) {
    if (actionId !== 'aiTranslationsPicker') return;
    if (!ctx.currentUserAccessToken) {
      ctx.alert('No user access token found');
      return;
    }
    const accessToken = ctx.currentUserAccessToken;

    // Resolve the set of models present in the selection. Each item's
    // `item_type` reference resolves through the SDK's `ctx.itemTypes`
    // repo, which is populated for whichever item types the CMS has
    // already loaded. We fall back to the relationship id if name/api_key
    // aren't found — better to show a usable picker than to abort.
    const uniqueItemTypeIds = Array.from(
      new Set(
        items
          .map((item) => item.relationships?.item_type?.data?.id)
          .filter((id): id is string => typeof id === 'string'),
      ),
    );

    const models: AITranslationsPickerModalParams['models'] =
      uniqueItemTypeIds.map((id) => {
        const itemType = ctx.itemTypes[id];
        return {
          value: id,
          label: itemType?.attributes?.name ?? `Model ${id}`,
          code: itemType?.attributes?.api_key ?? id,
        };
      });

    if (models.length === 0) {
      ctx.alert('Could not resolve the models for the selected records.');
      return;
    }

    const pluginParams = getPluginParams(ctx);

    try {
      const itemIds = items.map((item) => item.id);
      const pickerParams: AITranslationsPickerModalParams = {
        itemIds,
        models,
        pluginParams,
        accessToken,
      };

      const result = (await ctx.openModal({
        id: 'aiTranslationsPickerModal',
        title: 'AI Translations',
        width: 'l',
        parameters: pickerParams as unknown as Record<string, unknown>,
      })) as AITranslationsPickerModalResult | undefined;

      // The picker resolves with `config` only when the user clicked
      // "Translate"; anything else (dismissed/cancelled) bails out here.
      if (!result?.config) return;

      const {
        fromLocale,
        toLocales,
        selectedFieldsByModel,
        models: modelsBreakdown,
      } = result.config;

      // Styled confirm modal (record count + locale chips + per-model field
      // breakdown) instead of the native text-only openConfirm. Opened here in
      // the dropdown handler's non-modal context — NOT inside the picker modal,
      // which would nest modal-on-modal and hang behind the current modal.
      const confirmParams: TranslationConfirmModalParams = {
        recordCount: itemIds.length,
        fromLocale,
        toLocales,
        models: modelsBreakdown,
      };
      const confirmed = await ctx.openModal({
        id: 'translationConfirmModal',
        title: 'Start translation?',
        width: 'm',
        parameters: confirmParams as unknown as Record<string, unknown>,
      });

      if (confirmed !== true) return;

      const progressParams: TranslationProgressModalParams = {
        totalRecords: itemIds.length,
        fromLocale,
        toLocales,
        accessToken,
        pluginParams,
        itemIds,
        selectedFieldsByModel,
      };

      const progressResult = (await ctx.openModal({
        id: 'translationProgressModal',
        title: 'Translation Progress',
        width: 'l',
        parameters: progressParams as unknown as Record<string, unknown>,
      })) as
        | {
            completed?: boolean;
            canceled?: boolean;
            progress?: import('./utils/translation/ItemsDropdownUtils').ProgressUpdate[];
          }
        | undefined;

      const flagged = (progressResult?.progress ?? []).filter(
        (update) =>
          update.status === 'error' ||
          update.status === 'completed-with-warnings',
      );
      if (progressResult?.canceled) {
        await ctx.notice('Bulk translation was canceled');
      } else if (flagged.length > 0) {
        const reviewList = flagged
          .slice(0, 20)
          .map(
            (update) =>
              `• ${(update.warnings?.[0] ?? update.message ?? update.recordId).slice(0, 140)}`,
          )
          .join('\n');
        const more =
          flagged.length > 20 ? `\n…and ${flagged.length - 20} more.` : '';
        await ctx.alert(
          `Translation finished — ${flagged.length} record(s) need review:\n${reviewList}${more}`,
        );
      } else if (progressResult?.completed) {
        await ctx.notice(`Successfully translated ${items.length} record(s).`);
      }
      // else: the modal was dismissed via its chrome (no result) — say nothing.
    } catch (error) {
      handleUIError(error, pluginParams.vendor, ctx);
    }

    return;
  },

  /**
   * Registers a sidebar panel if 'translateWholeRecord' is enabled.
   */
  itemFormSidebarPanels(model: ItemType, ctx: ItemFormSidebarPanelsCtx) {
    const pluginParams = getPluginParams(ctx);
    const isRoleExcluded =
      pluginParams.rolesToBeExcludedFromThisPlugin.includes(ctx.currentRole.id);
    const isModelExcluded =
      pluginParams.modelsToBeExcludedFromThisPlugin.includes(
        model.attributes.api_key,
      );

    if (
      !pluginParams.translateWholeRecord ||
      isModelExcluded ||
      isRoleExcluded
    ) {
      return [];
    }

    return [
      {
        id: 'datoGptTranslateSidebar',
        label: 'AI Translations',
        placement: ['after', 'info'],
        startOpen: true,
      },
    ];
  },

  /**
   * Render the actual sidebar panel if more than one locale is available.
   */
  renderItemFormSidebarPanel(
    sidebarPanelId,
    ctx: RenderItemFormSidebarPanelCtx,
  ) {
    const pluginParams = getPluginParams(ctx);
    if (!isProviderConfigured(pluginParams)) {
      return render(
        <Canvas ctx={ctx}>
          <p style={{ marginBottom: 'var(--spacing-m)', textAlign: 'center' }}>
            Please configure valid credentials in plugin settings.
          </p>
          <Button
            fullWidth
            onClick={() =>
              ctx.navigateTo(buildPluginSettingsPath(ctx))
            }
          >
            Open Settings
          </Button>
        </Canvas>,
      );
    }
    if (sidebarPanelId === 'datoGptTranslateSidebar') {
      if (
        Array.isArray(ctx.formValues.internalLocales) &&
        ctx.formValues.internalLocales.length > 1
      ) {
        return render(
          <ErrorBoundary
            onNavigateToSettings={() =>
              ctx.navigateTo(buildPluginSettingsPath(ctx))
            }
          >
            <TranslateSidebar ctx={ctx} />
          </ErrorBoundary>,
        );
      }
      return render(
        <Canvas ctx={ctx}>
          <p>
            For the translate feature to work, you need to have more than one
            locale in this record.
          </p>
        </Canvas>,
      );
    }
    return null;
  },

  /**
   * Creates dropdown actions for each translatable field.
   */
  fieldDropdownActions(_field, ctx: FieldDropdownActionsCtx) {
    const pluginParams = getPluginParams(ctx);

    // If plugin is not properly configured, show an error action
    if (!isProviderConfigured(pluginParams)) {
      return [
        {
          id: 'not-configured',
          label: 'Please configure valid AI vendor credentials',
          icon: 'language',
        } as DropdownAction,
      ];
    }

    if (isFieldDropdownSuppressed(pluginParams, ctx)) {
      return [];
    }

    const fieldType = ctx.field.attributes.appearance.editor;
    const fieldValue =
      ctx.formValues[ctx.field.attributes.api_key] ||
      (ctx.parentField?.attributes.localized &&
        getValueAtPath(ctx.formValues, ctx.fieldPath));

    const hasFieldValueInThisLocale = resolveHasFieldValueInLocale(
      fieldType,
      fieldValue,
      ctx.locale,
    );

    const hasOtherLocales =
      Array.isArray(ctx.formValues.internalLocales) &&
      ctx.formValues.internalLocales.length > 1;

    const isLocalized = ctx.field.attributes.localized;
    const actionsArray: (DropdownAction | DropdownActionGroup)[] = [];
    const availableLocales = ctx.formValues.internalLocales as string[];

    // "Translate to" actions
    if (isLocalized && hasOtherLocales && hasFieldValueInThisLocale) {
      actionsArray.push({
        label: 'Translate to',
        icon: 'language',
        actions: [
          {
            id: 'translateTo.allLocales',
            label: 'All locales',
            icon: 'globe',
          },
          ...availableLocales
            .filter((locale) => locale !== ctx.locale)
            .map((locale) => ({
              id: `translateTo.${locale}`,
              label: formatLocaleWithCode(locale),
              icon: 'globe',
            })),
        ],
      } as DropdownActionGroup);
    }

    // "Translate from" actions
    if (isLocalized && hasOtherLocales) {
      actionsArray.push({
        label: 'Translate from',
        icon: 'language',
        actions: [
          ...availableLocales
            .filter((locale) => locale !== ctx.locale)
            .map((locale) => ({
              id: `translateFrom.${locale}`,
              label: formatLocaleWithCode(locale),
              icon: 'globe',
            })),
        ],
      } as DropdownActionGroup);
    }

    return actionsArray;
  },

  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    switch (fieldExtensionId) {
      case 'loadingAddon':
        return render(
          <ErrorBoundary>
            <LoadingAddon ctx={ctx} />
          </ErrorBoundary>,
        );
      default:
        // Unknown field extension; return null to let SDK handle gracefully
        return null;
    }
  },

  /**
   * Handler for the actual translation action triggered from the dropdown.
   */
  async executeFieldDropdownAction(
    actionId: string,
    ctx: ExecuteFieldDropdownActionCtx,
  ) {
    const pluginParams = getPluginParams(ctx);
    const logger = createLogger(pluginParams, 'executeFieldDropdownAction');
    const locales = ctx.formValues.internalLocales as string[];
    const fieldType = ctx.field.attributes.appearance.editor;
    const fieldValue = ctx.formValues[ctx.field.attributes.api_key];

    // "translateFrom" flow
    if (actionId.startsWith('translateFrom')) {
      const locale = actionId.split('.')[1];

      const fieldValueInSourceLocale = (
        fieldValue as Record<string, unknown>
      )?.[locale];
      if (!fieldValueInSourceLocale) {
        ctx.alert(
          `The field on the ${formatLocaleWithCode(locale)} locale is empty`,
        );
        return;
      }

      ctx.customToast({
        type: 'warning',
        message: `Translating "${ctx.field.attributes.label}" from ${formatLocaleWithCode(locale)}...`,
        dismissAfterTimeout: true,
      });
      const qcFlags: QcFlag[] = [];
      let translatedValue: unknown;
      try {
        translatedValue = await TranslateField(
          fieldValueInSourceLocale,
          ctx,
          pluginParams,
          ctx.locale,
          locale,
          fieldType,
          ctx.environment,
          undefined,
          '',
          (flag) => qcFlags.push(flag),
        );
      } catch (e) {
        const provider = getProvider(pluginParams);
        const normalized = normalizeProviderError(e, provider.vendor);
        ctx.alert(formatErrorForUser(normalized));
        return;
      }

      // Persist translated value into the current editing locale
      const fieldPath = `${ctx.field.attributes.api_key}.${ctx.locale}`;
      logger.info('Translated field payload', {
        flow: 'dropdown',
        actionId,
        fieldPath,
        fieldId: ctx.field.id,
        fieldApiKey: ctx.field.attributes.api_key,
        fieldType,
        sourceLocale: locale,
        targetLocale: ctx.locale,
        value: translatedValue,
      });
      logger.info('Form write payload', {
        flow: 'dropdown',
        actionId,
        fieldPath,
        fieldId: ctx.field.id,
        fieldApiKey: ctx.field.attributes.api_key,
        fieldType,
        sourceLocale: locale,
        targetLocale: ctx.locale,
        value: translatedValue,
      });
      await ctx.setFieldValue(fieldPath, translatedValue);
      ctx.notice(
        `Translated "${ctx.field.attributes.label}" from ${formatLocaleWithCode(locale)}`,
      );
      surfaceFieldQcFlags(ctx, qcFlags);

      return;
    }

    // "translateTo" flow
    if (actionId.startsWith('translateTo')) {
      const locale = actionId.split('.')[1];

      // Translate to all locales
      if (locale === 'allLocales') {
        ctx.customToast({
          type: 'warning',
          message: `Translating "${ctx.field.attributes.label}" to all locales...`,
          dismissAfterTimeout: true,
        });

        const qcFlags: QcFlag[] = [];
        /**
         * Translates a single locale and writes the result to the form.
         * Extracted to avoid await-in-loop lint errors in the sequential chain.
         */
        const translateToLocale = async (loc: string): Promise<void> => {
          let translatedValue: unknown;
          try {
            translatedValue = await TranslateField(
              (fieldValue as Record<string, unknown>)?.[ctx.locale],
              ctx,
              pluginParams,
              loc,
              ctx.locale,
              fieldType,
              ctx.environment,
              undefined,
              '',
              (flag) => qcFlags.push(flag),
            );
          } catch (e) {
            const provider = getProvider(pluginParams);
            const normalized = normalizeProviderError(e, provider.vendor);
            ctx.alert(formatErrorForUser(normalized));
            return;
          }

          const fieldPath = `${ctx.field.attributes.api_key}.${loc}`;
          logger.info('Translated field payload', {
            flow: 'dropdown',
            actionId,
            fieldPath,
            fieldId: ctx.field.id,
            fieldApiKey: ctx.field.attributes.api_key,
            fieldType,
            sourceLocale: ctx.locale,
            targetLocale: loc,
            value: translatedValue,
          });
          logger.info('Form write payload', {
            flow: 'dropdown',
            actionId,
            fieldPath,
            fieldId: ctx.field.id,
            fieldApiKey: ctx.field.attributes.api_key,
            fieldType,
            sourceLocale: ctx.locale,
            targetLocale: loc,
            value: translatedValue,
          });
          await ctx.setFieldValue(fieldPath, translatedValue);
        };

        const targetLocales = locales.filter((loc) => loc !== ctx.locale);
        await targetLocales.reduce(
          (chain, loc) => chain.then(() => translateToLocale(loc)),
          Promise.resolve(),
        );

        ctx.notice(`Translated "${ctx.field.attributes.label}" to all locales`);
        surfaceFieldQcFlags(ctx, qcFlags);
        return;
      }

      // Translate to a specific locale
      ctx.customToast({
        dismissAfterTimeout: true,
        type: 'warning',
        message: `Translating "${ctx.field.attributes.label}" to ${formatLocaleWithCode(locale)}...`,
      });

      const qcFlags: QcFlag[] = [];
      let translatedValue: unknown;
      try {
        translatedValue = await TranslateField(
          (fieldValue as Record<string, unknown>)?.[ctx.locale],
          ctx,
          pluginParams,
          locale,
          ctx.locale,
          fieldType,
          ctx.environment,
          undefined,
          '',
          (flag) => qcFlags.push(flag),
        );
      } catch (e) {
        const provider = getProvider(pluginParams);
        const normalized = normalizeProviderError(e, provider.vendor);
        ctx.alert(formatErrorForUser(normalized));
        return;
      }

      const fieldPath = `${ctx.field.attributes.api_key}.${locale}`;
      logger.info('Translated field payload', {
        flow: 'dropdown',
        actionId,
        fieldPath,
        fieldId: ctx.field.id,
        fieldApiKey: ctx.field.attributes.api_key,
        fieldType,
        sourceLocale: ctx.locale,
        targetLocale: locale,
        value: translatedValue,
      });
      logger.info('Form write payload', {
        flow: 'dropdown',
        actionId,
        fieldPath,
        fieldId: ctx.field.id,
        fieldApiKey: ctx.field.attributes.api_key,
        fieldType,
        sourceLocale: ctx.locale,
        targetLocale: locale,
        value: translatedValue,
      });
      await ctx.setFieldValue(fieldPath, translatedValue);
      ctx.notice(
        `Translated "${ctx.field.attributes.label}" to ${formatLocaleWithCode(locale)}`,
      );
      surfaceFieldQcFlags(ctx, qcFlags);
      return;
    }

    // If the plugin is not configured, navigate to its config screen
    if (actionId === 'not-configured') {
      ctx.navigateTo(buildPluginSettingsPath(ctx));
    }
  },

  /**
   * Renders modal components.
   */
  renderModal(modalId: string, ctx: RenderModalCtx) {
    switch (modalId) {
      case 'translationProgressModal':
        if (!isTranslationProgressModalParams(ctx.parameters)) {
          return render(
            <Canvas ctx={ctx}>
              <p>Invalid modal parameters</p>
            </Canvas>,
          );
        }
        return render(
          <ErrorBoundary>
            <TranslationProgressModal ctx={ctx} parameters={ctx.parameters} />
          </ErrorBoundary>,
        );
      case 'aiTranslationsPickerModal':
        return render(
          <ErrorBoundary>
            <AITranslationsPickerModal
              ctx={ctx}
              parameters={
                ctx.parameters as unknown as AITranslationsPickerModalParams
              }
            />
          </ErrorBoundary>,
        );
      case 'translationConfirmModal':
        if (!isTranslationConfirmModalParams(ctx.parameters)) {
          return render(
            <Canvas ctx={ctx}>
              <p>Invalid modal parameters</p>
            </Canvas>,
          );
        }
        return render(
          <ErrorBoundary>
            <TranslationConfirmModal ctx={ctx} parameters={ctx.parameters} />
          </ErrorBoundary>,
        );
      default:
        return null;
    }
  },
});
