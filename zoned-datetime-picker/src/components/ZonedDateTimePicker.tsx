import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { useState } from 'react';
import { parseStoredFieldValue } from '../utils/datetime';
import { FieldParseError } from './FieldParseError';
import { ZonedDateTimeEditor } from './ZonedDateTimeEditor';

/**
 * ZonedDateTime field editor entry point.
 *
 * Parses the stored value once on mount and routes to either the editor or,
 * when the value is unreadable, a read-only error view that preserves the data
 * instead of overwriting it with an empty payload.
 */
export const ZonedDateTimePicker = ({
  ctx,
}: {
  ctx: RenderFieldExtensionCtx;
}) => {
  const [parseResult] = useState(() =>
    parseStoredFieldValue(ctx.formValues[ctx.fieldPath]),
  );

  if (!parseResult.ok) {
    return <FieldParseError ctx={ctx} raw={parseResult.raw} />;
  }

  return <ZonedDateTimeEditor ctx={ctx} initialValue={parseResult.value} />;
};
