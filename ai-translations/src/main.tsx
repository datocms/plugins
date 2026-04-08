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
import ErrorBoundary from './components/ErrorBoundary';
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
import DatoGPTTranslateSidebar from './entrypoints/Sidebar/DatoGPTTranslateSidebar';
import { defaultPrompt } from './prompts/DefaultPrompt';
import { localeSelect } from './utils/localeUtils';
import { render } from './utils/render';
// Import refactored utility functions and types
import { parseActionId } from './utils/translation/ItemsDropdownUtils';
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
import { isEmptyStructuredText } from './utils/translation/utils';

/**
 * Result shape returned from the translation progress modal.
 */
interface TranslationModalResult {
  completed: boolean;
  canceled: boolean;
}

/**
 * Parameters passed to the TranslationProgressModal.
 * Shared interface between modal opener and renderer for type safety.
 */
interface TranslationProgressModalParams {
  totalRecords: number;
  fromLocale: string;
  toLocale: string;
  accessToken: string;
  pluginParams: ctxParamsType;
  itemIds: string[];
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
    typeof p.toLocale === 'string' &&
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
 * Type guard for TranslationModalResult.
 * The modal can return undefined or an object with completed/canceled flags.
 */
function isTranslationModalResult(
  value: unknown,
): value is TranslationModalResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    ('completed' in value || 'canceled' in value)
  );
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
              ctx.navigateTo(`/configuration/plugins/${ctx.plugin.id}/edit`)
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

    return ctx.site.attributes.locales.map((locale) => ({
      label: `Translate Record from ${locale}`,
      icon: 'language',
      actions: ctx.site.attributes.locales
        .filter((targetLocale) => targetLocale !== locale)
        .map((targetLocale) => ({
          label: `to ${targetLocale}`,
          icon: 'globe',
          id: `translateRecord-${locale}-${targetLocale}`,
        })),
    }));
  },

  async executeItemsDropdownAction(
    actionId: string,
    items: Item[],
    ctx: ExecuteItemsDropdownActionCtx,
  ) {
    if (!ctx.currentUserAccessToken) {
      ctx.alert('No user access token found');
      return;
    }

    // Parse action ID to get locale information
    const { fromLocale, toLocale } = parseActionId(actionId);

    const pluginParams = getPluginParams(ctx);

    // Open a modal to show translation progress and handle translation process
    const modalPromise = ctx.openModal({
      id: 'translationProgressModal',
      title: 'Translation Progress',
      width: 'l',
      parameters: {
        totalRecords: items.length,
        fromLocale,
        toLocale,
        accessToken: ctx.currentUserAccessToken,
        pluginParams,
        itemIds: items.map((item) => item.id),
      },
    });

    try {
      // Wait for the modal to be closed by the user
      const result = await modalPromise;

      if (isTranslationModalResult(result)) {
        if (result.completed) {
          await ctx.notice(
            `Successfully translated ${items.length} record(s) from ${fromLocale} to ${toLocale}`,
          );
        } else if (result.canceled) {
          await ctx.notice(
            `Translation from ${fromLocale} to ${toLocale} was canceled`,
          );
        } else {
          await ctx.alert(
            'The translation failed with errors.',
          );
        }
      }
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
        label: 'DatoGPT Translate',
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
              ctx.navigateTo(`/configuration/plugins/${ctx.plugin.id}/edit`)
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
              ctx.navigateTo(`/configuration/plugins/${ctx.plugin.id}/edit`)
            }
          >
            <DatoGPTTranslateSidebar ctx={ctx} />
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
              label: localeSelect(locale)?.name,
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
              label: localeSelect(locale)?.name,
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
          `The field on the ${localeSelect(locale)?.name} locale is empty`,
        );
        return;
      }

      ctx.customToast({
        type: 'warning',
        message: `Translating "${ctx.field.attributes.label}" from ${
          localeSelect(locale)?.name
        }...`,
        dismissAfterTimeout: true,
      });
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
        );
      } catch (e) {
        const provider = getProvider(pluginParams);
        const normalized = normalizeProviderError(e, provider.vendor);
        ctx.alert(formatErrorForUser(normalized));
        return;
      }

      // Persist translated value into the current editing locale
      await ctx.setFieldValue(
        `${ctx.field.attributes.api_key}.${ctx.locale}`,
        translatedValue,
      );
      ctx.notice(
        `Translated "${ctx.field.attributes.label}" from ${
          localeSelect(locale)?.name
        }`,
      );

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
            );
          } catch (e) {
            const provider = getProvider(pluginParams);
            const normalized = normalizeProviderError(e, provider.vendor);
            ctx.alert(formatErrorForUser(normalized));
            return;
          }

          await ctx.setFieldValue(
            `${ctx.field.attributes.api_key}.${loc}`,
            translatedValue,
          );
        };

        const targetLocales = locales.filter((loc) => loc !== ctx.locale);
        await targetLocales.reduce(
          (chain, loc) => chain.then(() => translateToLocale(loc)),
          Promise.resolve(),
        );

        ctx.notice(`Translated "${ctx.field.attributes.label}" to all locales`);
        return;
      }

      // Translate to a specific locale
      ctx.customToast({
        dismissAfterTimeout: true,
        type: 'warning',
        message: `Translating "${ctx.field.attributes.label}" to ${
          localeSelect(locale)?.name
        }...`,
      });

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
        );
      } catch (e) {
        const provider = getProvider(pluginParams);
        const normalized = normalizeProviderError(e, provider.vendor);
        ctx.alert(formatErrorForUser(normalized));
        return;
      }

      await ctx.setFieldValue(
        `${ctx.field.attributes.api_key}.${locale}`,
        translatedValue,
      );
      ctx.notice(
        `Translated "${ctx.field.attributes.label}" to ${
          localeSelect(locale)?.name
        }`,
      );
      return;
    }

    // If the plugin is not configured, navigate to its config screen
    if (actionId === 'not-configured') {
      ctx.navigateTo(`/configuration/plugins/${ctx.plugin.id}/edit`);
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
      default:
        return null;
    }
  },
});
