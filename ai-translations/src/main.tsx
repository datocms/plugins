/**
 * main.tsx
 * -------------------------------------------
 * This file connects the plugin to DatoCMS,
 * defines field dropdown actions, and triggers
 * the translation logic when actions are invoked.
 */

// The kit stylesheet loads first, thus the CSS modules of the plugin come
// after it and win at the same specificity
import 'datocms-react-ui/styles.css';
import './frame.css';
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
import AITranslationsPickerModal, {
  type AITranslationsPickerModalParams,
  type AITranslationsPickerModalResult,
  PICKER_DISMISSED,
} from './components/AITranslationsPickerModal';
import {
  PICKER_MODAL_TITLE,
  PROGRESS_MODAL_TITLE,
  reportTranslationOutcome,
} from './components/BulkTranslations/bulkCopy';
import InvalidModalParameters from './components/InvalidModalParameters';
import TranslationConfirmModal, {
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
import TranslateSidebar from './entrypoints/Sidebar/TranslateSidebar';
import { defaultPrompt } from './prompts/DefaultPrompt';
import {
  buildLocaleSettingsPath,
  buildPluginSettingsPath,
} from './utils/dashboardPaths';
import { formatList, formatLocaleWithCode } from './utils/localeUtils';
import { createLogger } from './utils/logging/Logger';
import { renderFrame } from './utils/render';
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
    typeof p.pluginParams === 'object' &&
    p.pluginParams !== null &&
    Array.isArray(p.itemIds)
  );
}

/** A locale of "Translate into → All other locales" that failed, and why. */
type LocaleFailure = { locale: string; message: string };

/**
 * The fields that "Translate into → All other locales" is translating, by
 * record and field path.
 */
const fieldsTranslatingIntoAll = new Set<string>();

/**
 * Runs "Translate into → All other locales" on the field of `ctx`, one run
 * at a time per field. The locales are translated one after the other, out
 * of view, so a short notice says that the run started. A second click while
 * it runs gets the notice again and starts nothing: a second run would pay
 * the vendor twice and race the writes of the first one.
 *
 * @param ctx - The ctx of the field dropdown action.
 * @param run - Translates the field and reports how it went.
 */
async function translateIntoAllOnce(
  ctx: ExecuteFieldDropdownActionCtx,
  run: () => Promise<void>,
): Promise<void> {
  void ctx.customToast({
    type: 'notice',
    message: `Translating “${ctx.field.attributes.label}” into all other locales…`,
    dismissAfterTimeout: 3000,
    dismissOnPageChange: true,
  });
  const runKey = `${ctx.item?.id ?? 'new'}/${ctx.fieldPath}`;
  if (fieldsTranslatingIntoAll.has(runKey)) return;
  fieldsTranslatingIntoAll.add(runKey);
  try {
    await run();
  } finally {
    fieldsTranslatingIntoAll.delete(runKey);
  }
}

/**
 * The text of a translation error for the user (the vendor in plain words).
 *
 * @param error - The caught error.
 * @param pluginParams - The plugin settings, for the vendor.
 */
function errorText(error: unknown, pluginParams: ctxParamsType): string {
  const provider = getProvider(pluginParams);
  return formatErrorForUser(normalizeProviderError(error, provider.vendor));
}

/**
 * The one toast at the end of "Translate into → All other locales": a notice
 * when every locale was translated, else one alert that says how many were,
 * which failed and why, and what to do with the others.
 *
 * @param ctx - The ctx of the field dropdown action.
 * @param failures - The locales that failed, with their causes.
 * @param targetLocales - The number of locales that the action translated to.
 */
function reportAllLocales(
  ctx: ExecuteFieldDropdownActionCtx,
  failures: LocaleFailure[],
  targetLocales: number,
) {
  const label = ctx.field.attributes.label;
  if (failures.length === 0) {
    ctx.notice(
      `Translated “${label}” into all other locales. Review them, then save the record.`,
    );
    return;
  }
  const translated = targetLocales - failures.length;
  const lead =
    translated > 0
      ? `Translated “${label}” into ${translated} of ${targetLocales} locales.`
      : `Couldn't translate “${label}”.`;
  const failed = `${formatList(failures.map((failure) => formatLocaleWithCode(failure.locale)))} failed.`;
  const causes = [...new Set(failures.map((failure) => failure.message))];
  const next =
    translated > 0
      ? ['Review the other translations, then save the record.']
      : [];
  ctx.alert([lead, failed, ...causes, ...next].join(' '));
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
 * What a role that can't open the plugin settings reads when no vendor is
 * set up: the vendor is a setting it never sees, so only who to ask.
 */
const EDITOR_NOT_SET_UP_MESSAGE =
  "Translation isn't set up yet. Ask an admin to set it up.";

/**
 * Checks, before the records picker opens, the problems the picker can't fix:
 * no AI provider set up, or a project with a single locale. Each shows a
 * non-blocking warning toast (with a way forward when the user has the
 * permission for it, else who to ask) and returns false.
 *
 * @param ctx - Items dropdown action context.
 * @param pluginParams - Plugin configuration parameters.
 * @returns True when the picker can open.
 */
function preflightItemsTranslation(
  ctx: ExecuteItemsDropdownActionCtx,
  pluginParams: ctxParamsType,
): boolean {
  const permissions = ctx.currentRole.meta.final_permissions;

  if (!isProviderConfigured(pluginParams)) {
    void ctx
      .customToast({
        type: 'warning',
        message: permissions.can_edit_schema
          ? 'No AI provider is set up yet.'
          : EDITOR_NOT_SET_UP_MESSAGE,
        dismissOnPageChange: true,
        ...(permissions.can_edit_schema
          ? { cta: { label: 'Open plugin settings', value: 'settings' } }
          : {}),
      })
      .then((choice) => {
        if (choice === 'settings') {
          void ctx.navigateTo(buildPluginSettingsPath(ctx));
        }
      });
    return false;
  }

  if (ctx.site.attributes.locales.length < 2) {
    void ctx
      .customToast({
        type: 'warning',
        message: permissions.can_edit_environment
          ? "This project has only one locale, so there's nothing to translate into."
          : "This project has only one locale, so there's nothing to translate into. Ask an admin to add another one.",
        dismissOnPageChange: true,
        ...(permissions.can_edit_environment
          ? { cta: { label: 'Go to locale settings', value: 'locales' } }
          : {}),
      })
      .then((choice) => {
        if (choice === 'locales') {
          void ctx.navigateTo(buildLocaleSettingsPath(ctx));
        }
      });
    return false;
  }

  return true;
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
  },

  renderConfigScreen(ctx) {
    return renderFrame(ctx, <ConfigScreen ctx={ctx} />);
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
            label: 'Bulk translations',
            icon: 'languages',
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
        // A full-height page: the frame keeps the size the host gives it
        return renderFrame(ctx, <AIBulkTranslationsPage ctx={ctx} />, {
          noAutoResizer: true,
          page: true,
        });
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
        label: 'Translate with AI',
        icon: 'languages',
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
      // The access to the token is a setting of the plugin: a role that can
      // open the settings gets the way there, the others who to ask.
      const canOpenSettings =
        ctx.currentRole.meta.final_permissions.can_edit_schema;
      void ctx
        .customToast({
          type: 'alert',
          message: canOpenSettings
            ? "The plugin can't access your API token."
            : "The plugin can't access your API token. Ask an admin to allow it in the plugin settings.",
          dismissOnPageChange: true,
          ...(canOpenSettings
            ? { cta: { label: 'Open plugin settings', value: 'settings' } }
            : {}),
        })
        .then((choice) => {
          if (choice === 'settings') {
            void ctx.navigateTo(buildPluginSettingsPath(ctx));
          }
        });
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

    const modelIdOf = (item: Item) => item.relationships?.item_type?.data?.id;
    const models: AITranslationsPickerModalParams['models'] =
      uniqueItemTypeIds.map((id) => {
        const itemType = ctx.itemTypes[id];
        return {
          value: id,
          label: itemType?.attributes?.name ?? `Model ${id}`,
          code: itemType?.attributes?.api_key ?? id,
          recordCount: new Set(
            items
              .filter((item) => modelIdOf(item) === id)
              .map((item) => item.id),
          ).size,
        };
      });

    if (models.length === 0) {
      ctx.alert("Couldn't find the models of the selected records.");
      return;
    }

    const pluginParams = getPluginParams(ctx);

    if (!preflightItemsTranslation(ctx, pluginParams)) return;

    try {
      const itemIds = [...new Set(items.map((item) => item.id))];
      // The records of the models excluded in the settings are skipped: the
      // picker says so, and the run leaves them out.
      const excludedModelIds = new Set(
        models
          .filter((model) =>
            pluginParams.modelsToBeExcludedFromThisPlugin?.includes(model.code),
          )
          .map((model) => model.value),
      );
      const runItemIds = [
        ...new Set(
          items
            .filter((item) => !excludedModelIds.has(modelIdOf(item) ?? ''))
            .map((item) => item.id),
        ),
      ];
      const pickerParams: AITranslationsPickerModalParams = {
        itemIds,
        models,
        pluginParams,
        accessToken,
      };

      // The picker ends with a footer (Cancel at the left), so the host
      // draws no cross (`closeDisabled`): its Cancel, and the Escape it
      // registers, dismiss it.
      const result = (await ctx.openModal({
        id: 'aiTranslationsPickerModal',
        title: PICKER_MODAL_TITLE,
        width: 'm',
        initialHeight: 480,
        closeDisabled: true,
        parameters: pickerParams as unknown as Record<string, unknown>,
      })) as AITranslationsPickerModalResult | undefined;

      // The picker resolves with `config` only when the user clicked
      // "Translate"; a dismissal resolves without it and bails out here.
      // Its submit is the commitment: it says what the run does to the
      // records, so no second dialog asks again.
      if (!result?.config) return;

      const { fromLocale, toLocales, selectedFieldsByModel } = result.config;

      // Opened here in the dropdown handler's non-modal context, NOT inside
      // the picker modal, which would nest modal-on-modal and hang behind the
      // current modal. It draws a footer, so the host draws no cross
      // (`closeDisabled`): a cross would close it mid-run and abort the job
      // without its summary.
      const progressParams: TranslationProgressModalParams = {
        totalRecords: runItemIds.length,
        fromLocale,
        toLocales,
        accessToken,
        pluginParams,
        itemIds: runItemIds,
        selectedFieldsByModel,
      };

      const progressResult = (await ctx.openModal({
        id: 'translationProgressModal',
        title: PROGRESS_MODAL_TITLE,
        width: 'l',
        closeDisabled: true,
        parameters: progressParams as unknown as Record<string, unknown>,
      })) as { completed?: boolean; canceled?: boolean } | undefined;

      reportTranslationOutcome(
        ctx,
        progressResult,
        runItemIds.length,
        ctx.ui.locale,
      );
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
   * Renders the sidebar panel. TranslateSidebar shows its own states for a
   * vendor that isn't set up and for a record with a single locale.
   */
  renderItemFormSidebarPanel(
    sidebarPanelId,
    ctx: RenderItemFormSidebarPanelCtx,
  ) {
    if (sidebarPanelId === 'datoGptTranslateSidebar') {
      return renderFrame(ctx, <TranslateSidebar ctx={ctx} />);
    }
    return null;
  },

  /**
   * Creates dropdown actions for each translatable field.
   */
  fieldDropdownActions(_field, ctx: FieldDropdownActionsCtx) {
    const pluginParams = getPluginParams(ctx);

    // If the plugin is not configured, a role that can open its settings
    // gets the way there; the others read that translation isn't set up.
    if (!isProviderConfigured(pluginParams)) {
      return [
        {
          id: 'not-configured',
          label: ctx.currentRole.meta.final_permissions.can_edit_schema
            ? 'Set up an AI provider'
            : "Translation isn't set up",
          icon: 'languages',
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
        label: 'Translate into',
        icon: 'languages',
        actions: [
          {
            id: 'translateTo.allLocales',
            label: 'All other locales',
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

    // "Translate from" actions: only the other locales that have a value,
    // since an empty one has nothing to translate from.
    const sourceLocales =
      isLocalized && hasOtherLocales
        ? availableLocales.filter(
            (locale) =>
              locale !== ctx.locale &&
              resolveHasFieldValueInLocale(fieldType, fieldValue, locale),
          )
        : [];
    if (sourceLocales.length > 0) {
      actionsArray.push({
        label: 'Translate from',
        icon: 'languages',
        actions: sourceLocales.map((locale) => ({
          id: `translateFrom.${locale}`,
          label: formatLocaleWithCode(locale),
          icon: 'globe',
        })),
      } as DropdownActionGroup);
    }

    return actionsArray;
  },

  renderFieldExtension(fieldExtensionId: string, ctx: RenderFieldExtensionCtx) {
    switch (fieldExtensionId) {
      // A legacy add-on that some fields still carry. Nothing loads there,
      // so it shows nothing, in a frame with no height.
      case 'loadingAddon':
        void ctx.setHeight(0);
        return renderFrame(ctx, null, { noAutoResizer: true });
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
      const label = ctx.field.attributes.label;
      // The menu lists only the locales with a value: this guards a value
      // that was emptied after the menu was built.
      if (!fieldValueInSourceLocale) {
        ctx.alert(
          `“${label}” is empty in ${formatLocaleWithCode(locale)}, so there's nothing to translate from.`,
        );
        return;
      }

      // No start toast: the value shows in the field in a moment, and the
      // toast at the end says how it went.
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
        ctx.alert(
          `Couldn't translate “${label}” from ${formatLocaleWithCode(locale)}. ${errorText(e, pluginParams)}`,
        );
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
        `Translated “${label}” from ${formatLocaleWithCode(locale)}. Review it, then save the record.`,
      );

      return;
    }

    // "translateTo" flow
    if (actionId.startsWith('translateTo')) {
      const locale = actionId.split('.')[1];

      // Translate to all the other locales
      if (locale === 'allLocales') {
        const targetLocales = locales.filter((loc) => loc !== ctx.locale);
        const failures: LocaleFailure[] = [];

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
            // The toast at the end names the failed locales and why.
            failures.push({ locale: loc, message: errorText(e, pluginParams) });
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

        await translateIntoAllOnce(ctx, async () => {
          await targetLocales.reduce(
            (chain, loc) => chain.then(() => translateToLocale(loc)),
            Promise.resolve(),
          );
          reportAllLocales(ctx, failures, targetLocales.length);
        });
        return;
      }

      // Translate to a specific locale. No start toast: the one at the end
      // follows in a moment.
      const label = ctx.field.attributes.label;

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
        ctx.alert(
          `Couldn't translate “${label}” into ${formatLocaleWithCode(locale)}. ${errorText(e, pluginParams)}`,
        );
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
        `Translated “${label}” into ${formatLocaleWithCode(locale)}. Review it, then save the record.`,
      );
      return;
    }

    // If the plugin is not configured, a role that can open its settings
    // goes there; the others are told who to ask.
    if (actionId === 'not-configured') {
      if (ctx.currentRole.meta.final_permissions.can_edit_schema) {
        ctx.navigateTo(buildPluginSettingsPath(ctx));
        return;
      }
      void ctx.customToast({
        type: 'warning',
        message: EDITOR_NOT_SET_UP_MESSAGE,
        dismissOnPageChange: true,
      });
    }
  },

  /**
   * Renders modal components.
   */
  renderModal(modalId: string, ctx: RenderModalCtx) {
    // The error fallback and the invalid-parameters state close these
    // dialogs with the value that a dismissal means to their caller. None of
    // the three has a host cross (`closeDisabled`), so their Close, and the
    // Escape they register, are the ways out.
    switch (modalId) {
      case 'translationProgressModal': {
        const close = () => ctx.resolve(null);
        if (!isTranslationProgressModalParams(ctx.parameters)) {
          return renderFrame(ctx, <InvalidModalParameters onClose={close} />);
        }
        // The modal sizes its frame itself (useFrameHeight): its list of
        // records scrolls, and the auto-resizer would grow the frame to fit
        // the rows clipped by that box.
        return renderFrame(
          ctx,
          <TranslationProgressModal ctx={ctx} parameters={ctx.parameters} />,
          { noAutoResizer: true, onClose: close },
        );
      }
      case 'aiTranslationsPickerModal':
        return renderFrame(
          ctx,
          <AITranslationsPickerModal
            ctx={ctx}
            parameters={
              ctx.parameters as unknown as AITranslationsPickerModalParams
            }
          />,
          { onClose: () => ctx.resolve(PICKER_DISMISSED) },
        );
      case 'translationConfirmModal': {
        const close = () => ctx.resolve(false);
        if (!isTranslationConfirmModalParams(ctx.parameters)) {
          return renderFrame(ctx, <InvalidModalParameters onClose={close} />);
        }
        return renderFrame(
          ctx,
          <TranslationConfirmModal ctx={ctx} parameters={ctx.parameters} />,
          { onClose: close },
        );
      }
      default:
        return null;
    }
  },
});
