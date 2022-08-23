import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import { Canvas } from "datocms-react-ui";
import get from "lodash-es/get";
import deepEqual from "fast-deep-equal";
import { useRef, useState } from "react";
import { useDeepCompareEffect } from "use-deep-compare";
import { Empty } from "../../components/Empty";
import TableEditor from "../../components/TableEditor";
import { Value, isValue } from "../../types";

type Props = {
  ctx: RenderFieldExtensionCtx;
};

type InnerValue = "invalid" | Value | null;

function toInnerValue(value: string | null): InnerValue {
  if (value === null) {
    return null;
  }

  const parsedValue = JSON.parse(value);

  if (!isValue(parsedValue)) {
    return "invalid";
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
  }, [rawValue, value]);

  if (value === "invalid") {
    return <Canvas ctx={ctx}>Invalid value!</Canvas>;
  }

  const handleUpdate = (value: Value | null) => {
    pendingChange.current = true;
    setValue(value);
    ctx.setFieldValue(
      ctx.fieldPath,
      value === null ? null : JSON.stringify(value, null, 2)
    );
  };

  const handleOpenInFullScreen = async () => {
    const exitValue = (await ctx.openModal({
      id: "table-editor",
      parameters: { value },
      width: 1900,
      title: "Edit table",
      closeDisabled: true,
    })) as Value | null | "abort";

    if (exitValue === "abort") {
      return;
    }

    handleUpdate(exitValue);
  };

  return (
    <Canvas ctx={ctx}>
      {value === null ? (
        <Empty onChange={handleUpdate} />
      ) : (
        <TableEditor
          value={value}
          onChange={handleUpdate}
          onOpenInFullScreen={handleOpenInFullScreen}
        />
      )}
    </Canvas>
  );
}
