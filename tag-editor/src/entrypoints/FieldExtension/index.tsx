import { useState, useEffect } from "react";
import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
import { Canvas } from "datocms-react-ui";
import get from "lodash-es/get";
import { WithContext as ReactTags } from "react-tag-input";
import s from "./styles.module.css";

type Props = {
  ctx: RenderFieldExtensionCtx;
};

type TagValue = {
  id: string;
  text: string;
};

type SerializedValue = Array<TagValue>;

type SerializeProps = {
  ctx: RenderFieldExtensionCtx;
  newValue: SerializedValue;
};

function deserialize({ ctx }: Props) {
  const fieldValue = get(ctx.formValues, ctx.fieldPath) as string | null;

  if (!fieldValue) {
    return [];
  }

  if (ctx.field.attributes.field_type === "json") {
    return JSON.parse(fieldValue).map((key: string) => ({
      id: key,
      text: key,
    }));
  }

  return fieldValue.split(", ").map((key) => ({ id: key, text: key }));
}

function serializeValue({ newValue, ctx }: SerializeProps) {
  if (ctx.field.attributes.field_type === "json") {
    return JSON.stringify(newValue.map((o) => o.text));
  }

  return newValue.map((o) => o.text).join(", ");
}

export default function FieldExtension({ ctx }: Props) {
  const [value, setValue] = useState(deserialize({ ctx }));

  useEffect(() => {
    setValue(deserialize({ ctx }));
  }, [ctx, setValue]);

  const handleAddition = (inputValue: TagValue) => {
    ctx.setFieldValue(
      ctx.fieldPath,
      serializeValue({ newValue: [...value, inputValue], ctx })
    );
  };

  const handleDelete = (index: number) => {
    value.splice(index, 1);

    ctx.setFieldValue(ctx.fieldPath, serializeValue({ newValue: value, ctx }));
  };

  const handleDrag = (
    inputValue: TagValue,
    currPos: number,
    newPos: number
  ) => {
    const newValue = value.slice();

    newValue.splice(currPos, 1);
    newValue.splice(newPos, 0, inputValue);

    ctx.setFieldValue(ctx.fieldPath, serializeValue({ newValue, ctx }));
  };

  return (
    <Canvas ctx={ctx}>
      <ReactTags
        tags={value}
        autofocus={false}
        placeholder="Add new string"
        handleAddition={handleAddition}
        handleDrag={handleDrag}
        handleDelete={handleDelete}
        classNames={{
          tags: s.tags,
          tagInput: s.tagInput,
          tagInputField: s.tagInputField,
          selected: s.selected,
          tag: s.tag,
          remove: s.remove,
          suggestions: s.suggestions,
          activeSuggestion: s.activeSuggestion,
        }}
      />
    </Canvas>
  );
}
