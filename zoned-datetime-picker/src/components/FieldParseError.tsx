import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import { useEffect } from 'react';
import { getUiLabels } from '../i18n/uiLabels';

/**
 * Read-only fallback shown when the stored field value cannot be parsed. This
 * should never happen — it signals corrupt data — so it surfaces the raw value
 * for support and alerts the user rather than silently discarding it.
 */
export const FieldParseError = ({
  ctx,
  raw,
}: {
  ctx: RenderFieldExtensionCtx;
  raw: unknown;
}) => {
  const labels = getUiLabels(ctx.ui.locale);
  const serialized =
    typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);

  // Mount-only: this view never re-parses, so the alert fires exactly once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-shot
  useEffect(() => {
    ctx
      .alert(`${labels.parseErrorTitle}. ${labels.parseErrorText}`)
      .catch(console.error);
  }, []);

  return (
    <>
      <Callout tone="danger" title={labels.parseErrorTitle}>
        {labels.parseErrorText}
      </Callout>
      <CodeSnippet
        code={serialized}
        ariaLabel={ctx.field.attributes.label}
        maxHeight={200}
      />
    </>
  );
};
