/** Copy a configured field between locales in the record editor. */
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import { useCallback, useRef, useState } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { valuesEqual } from '../services/localeUpdates';
import { getErrorMessage } from '../types';
import {
  cloneFieldValue,
  copyFormValueToLocales,
  getLocalizedFieldPath,
  getValueAtPath,
  loadFormBlockSchemas,
} from '../utils/fieldUtils';

interface FieldExtensionProps {
  ctx: RenderFieldExtensionCtx;
}

function temporaryBlockKey(ctx: RenderFieldExtensionCtx): string | undefined {
  if (!ctx.block || ctx.block.id) return;
  const suffix = `.${ctx.field.attributes.api_key}.${ctx.locale}`;
  if (!ctx.fieldPath.endsWith(suffix)) return;
  const block = getValueAtPath(
    ctx.formValues,
    ctx.fieldPath.slice(0, -suffix.length),
  );
  if (!block || typeof block !== 'object') return;
  const node = block as Record<string, unknown>;
  if (typeof node.itemTypeId === 'string' && typeof node.itemId === 'string')
    return node.itemId;
  if (
    (node.type === 'block' || node.type === 'inlineBlock') &&
    typeof node.key === 'string'
  )
    return node.key;
}

/** SDK updates may reuse this component for another record or block. */
function copyContextIdentity(ctx: RenderFieldExtensionCtx) {
  return [
    ctx.site.id,
    ctx.environment,
    ctx.cmaBaseUrl,
    ctx.item?.id,
    Boolean(ctx.block),
    ctx.block?.id,
    ctx.block?.blockModel.id,
    temporaryBlockKey(ctx),
    ctx.field.id,
    ctx.itemType.id,
    ctx.fieldPath,
    ctx.locale,
  ];
}

export default function FieldExtension({ ctx }: FieldExtensionProps) {
  const [isCopying, setIsCopying] = useState(false);
  const copyingRef = useRef(false);
  const latestCtx = useRef(ctx);
  latestCtx.current = ctx;
  const availableLocales = Array.isArray(ctx.formValues.internalLocales)
    ? [
        ...new Set(
          ctx.formValues.internalLocales.filter(
            (value): value is string => typeof value === 'string',
          ),
        ),
      ]
    : [];
  const mainLocale = availableLocales[0] ?? '';
  const isMultiLocale =
    availableLocales.length > 1 && ctx.field.attributes.localized;
  const isAtMainLocale = mainLocale === ctx.locale;

  const copyToLocales = useCallback(
    async (targetLocales: string[]) => {
      if (
        !isMultiLocale ||
        ctx.disabled ||
        ctx.isSubmitting ||
        copyingRef.current
      )
        return;

      const sourcePath = getLocalizedFieldPath(
        ctx.fieldPath,
        ctx.locale,
        mainLocale,
      );
      if (!sourcePath) {
        ctx.notice('Field value is not localized');
        return;
      }
      const sourceValue = getValueAtPath(ctx.formValues, sourcePath);
      if (sourceValue === undefined) {
        ctx.notice(`No value is available in ${mainLocale}`);
        return;
      }

      copyingRef.current = true;
      setIsCopying(true);
      try {
        const identity = copyContextIdentity(ctx);
        let contextChanged = false;
        const snapshot = cloneFieldValue(sourceValue);
        // New modular blocks may expose no stable identity. Source comparison
        // catches replacement/edits without rejecting snapshots from our writes.
        const checkSource = Boolean(
          ctx.block && !ctx.block.id && !temporaryBlockKey(ctx),
        );
        const fieldType = ctx.field.attributes.field_type;
        const schemas = await loadFormBlockSchemas(
          snapshot,
          fieldType,
          async (modelId) => {
            const fields = await ctx.loadItemTypeFields(modelId);
            return fields.map((field) => ({
              apiKey: field.attributes.api_key,
              fieldType: field.attributes.field_type,
              localized: field.attributes.localized,
            }));
          },
        );
        const result = await copyFormValueToLocales(
          snapshot,
          fieldType,
          schemas,
          targetLocales,
          async (locale, value) => {
            const currentCtx = latestCtx.current;
            const currentIdentity = copyContextIdentity(currentCtx);
            contextChanged ||= !identity.every(
              (part, index) => part === currentIdentity[index],
            );
            contextChanged ||=
              checkSource &&
              !valuesEqual(
                snapshot,
                getValueAtPath(currentCtx.formValues, sourcePath),
              );
            if (contextChanged)
              throw new Error(
                'The record, block or editing context changed during copying. Remaining locales were not modified.',
              );
            if (
              !Array.isArray(currentCtx.formValues.internalLocales) ||
              !currentCtx.formValues.internalLocales.includes(mainLocale) ||
              !currentCtx.formValues.internalLocales.includes(locale)
            )
              throw new Error(
                'The source or target locale is no longer available in this record.',
              );
            if (currentCtx.disabled || currentCtx.isSubmitting)
              throw new Error(
                'The field is currently disabled or the record is being saved.',
              );
            const targetPath = getLocalizedFieldPath(
              ctx.fieldPath,
              ctx.locale,
              locale,
            );
            if (!targetPath)
              throw new Error('Could not resolve the localized field path.');
            await currentCtx.setFieldValue(targetPath, value);
          },
        );

        if (result.failures.length > 0) {
          await ctx.alert(
            `Value copied to ${result.copied} of ${targetLocales.length} locales. ${result.failures.join('; ')}`,
          );
        } else {
          ctx.notice(
            isAtMainLocale
              ? 'Value copied to all locales'
              : `Value copied from ${mainLocale}`,
          );
        }
      } catch (error) {
        await ctx.alert(`Could not copy this field: ${getErrorMessage(error)}`);
      } finally {
        copyingRef.current = false;
        setIsCopying(false);
      }
    },
    [ctx, mainLocale, isMultiLocale, isAtMainLocale],
  );

  if (!isMultiLocale) return null;

  return (
    <ErrorBoundary ctx={ctx}>
      <Canvas ctx={ctx}>
        <Button
          onClick={() =>
            copyToLocales(
              isAtMainLocale ? availableLocales.slice(1) : [ctx.locale],
            )
          }
          disabled={isCopying || ctx.disabled || ctx.isSubmitting}
          buttonType="muted"
          buttonSize="s"
        >
          {isAtMainLocale ? 'Copy to all locales' : `Copy from ${mainLocale}`}
        </Button>
      </Canvas>
    </ErrorBoundary>
  );
}
