import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import deepEqual from 'fast-deep-equal';
import get from 'lodash-es/get';
import { useRef, useState } from 'react';
import { useDeepCompareEffect } from 'use-deep-compare';
import { Empty } from '../../components/Empty';
import TableEditor from '../../components/TableEditor';
import { isValue, type Value } from '../../types';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

type InnerValue = 'invalid' | Value | null;

function toInnerValue(value: string | null): InnerValue {
  if (value === null) {
    return null;
  }

  const parsedValue = JSON.parse(value);

  if (!isValue(parsedValue)) {
    return 'invalid';
  }

  return parsedValue;
}

export default function FieldExtension({ ctx }: Props) {
  const rawValue = get(ctx.formValues, ctx.fieldPath) as string | null;
  const [value, setValue] = useState<InnerValue>(toInnerValue(rawValue));
  const pendingChange = useRef(false);

  useDeepCompareEffect(() => {
    const newValue = toInnerValue(rawValue);
    if (deepEqual(newValue, value)) {
      return;
    }

    if (pendingChange.current) {
      pendingChange.current = false;
      return;
    }

    setValue(newValue);
  }, [value]);

  if (value === 'invalid') {
    return (
      <Callout tone="danger" title="The table editor can't read this value">
        It needs a JSON object with a “columns” list of names and a “data” list
        of rows.
      </Callout>
    );
  }

  const handleUpdate = (value: Value | null) => {
    pendingChange.current = true;
    setValue(value);
    ctx.setFieldValue(
      ctx.fieldPath,
      value === null ? null : JSON.stringify(value, null, 2),
    );
  };

  const handleOpenInFullScreen = async () => {
    const exitValue = (await ctx.openModal({
      id: 'table-editor',
      parameters: { value },
      width: 1900,
      title: 'Edit table',
      closeDisabled: true,
    })) as Value | null | 'abort';

    if (exitValue === 'abort') {
      return;
    }

    handleUpdate(exitValue);
  };

  return value === null ? (
    <Empty onChange={handleUpdate} disabled={ctx.disabled} />
  ) : (
    <TableEditor
      value={value}
      onChange={handleUpdate}
      onOpenInFullScreen={handleOpenInFullScreen}
      disabled={ctx.disabled}
    />
  );
}
