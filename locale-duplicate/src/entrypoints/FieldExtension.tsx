/**
 * Field extension component that adds copy buttons to configured fields
 * in the record editing interface.
 */
import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import { Canvas, Button } from "datocms-react-ui";
import { useCallback } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { isLocalizedField } from '../types';
import { removeBlockItemIdsImmutable } from '../utils/fieldUtils';

/**
 * Props for the FieldExtension component
 */
interface FieldExtensionProps {
  ctx: RenderFieldExtensionCtx;
}


/**
 * Renders copy buttons for localized fields based on the current locale.
 * - Main locale: shows "Copy to all locales" button
 * - Other locales: shows "Copy from [main locale]" button
 */
export default function FieldExtension({ ctx }: FieldExtensionProps) {
  // Get available locales from the record
  const availableLocales = ctx.formValues.internalLocales;

  // Don't show copy buttons if there's only one locale
  if(!(Array.isArray(availableLocales) && availableLocales.length > 1)) {
    return <></>
  }

  // The first locale is considered the main/default locale
  const mainLocale = availableLocales[0];
  const isAtMainLocale = mainLocale == ctx.locale;

  /**
   * Copy field value from main locale to all other locales
   */
  const copyToAllLocales = useCallback(async () => {
    const fieldValue = ctx.formValues[ctx.field.attributes.api_key];
    
    if (!isLocalizedField(fieldValue)) {
      ctx.notice("Field value is not localized");
      return;
    }
    
    const mainLocaleValue = fieldValue[mainLocale];

    for (const locale of availableLocales.slice(1)) {
      await ctx.setFieldValue(ctx.field.attributes.api_key + `.${locale}`, removeBlockItemIdsImmutable(mainLocaleValue));
    }
    ctx.notice("Value copied to all locales")
  }, [ctx, mainLocale, availableLocales]);

  /**
   * Copy field value from main locale to current locale
   */
  const copyFromMainLocale = useCallback(async () => {
    const fieldValue = ctx.formValues[ctx.field.attributes.api_key];
    
    if (!isLocalizedField(fieldValue)) {
      ctx.notice("Field value is not localized");
      return;
    }
    
    const mainLocaleValue = fieldValue[mainLocale];
    await ctx.setFieldValue(ctx.field.attributes.api_key + `.${ctx.locale}`, removeBlockItemIdsImmutable(mainLocaleValue));
    ctx.notice(`Value copied from ${mainLocale}`)
  }, [ctx, mainLocale]);

  return (
    <ErrorBoundary ctx={ctx}>
      <Canvas ctx={ctx}>
        {isAtMainLocale && <Button onClick={copyToAllLocales} buttonType="muted" buttonSize="s">
          Copy to all locales
        </Button>}
        {!isAtMainLocale && <Button onClick={copyFromMainLocale} buttonType="muted" buttonSize="s">
          Copy from {mainLocale}
        </Button>}
      </Canvas>
    </ErrorBoundary>
  );
}