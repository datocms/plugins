import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import get from 'lodash-es/get';
import { WithContext as ReactTags } from 'react-tag-input';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

type TagValue = {
  id: string;
  text: string;
};

function isValidJson(value: any): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function deserialize(value: any, fieldType: 'json' | 'string'): TagValue[] {
  if (!value) {
    return [];
  }

  if (fieldType === 'json') {
    const parsed = JSON.parse(value);

    if (!isValidJson(parsed)) {
      throw new Error('Incompatible value!');
    }

    return parsed.map((tag: string) => ({
      id: tag,
      text: tag,
    }));
  }

  if (typeof value === 'string') {
    return value
      .trim()
      .split(/\s*,\s*/)
      .map((tag) => ({ id: tag, text: tag }));
  }

  throw new Error('Incompatible value!');
}

function serialize(value: TagValue[], fieldType: 'json' | 'string'): string {
  if (fieldType === 'json') {
    return JSON.stringify(value.map((o) => o.text));
  }

  return value.map((o) => o.text).join(', ');
}

export default function FieldExtension({ ctx }: Props) {
  const fieldType = ctx.field.attributes.field_type as 'string' | 'json';
  const value = get(ctx.formValues, ctx.fieldPath);

  let tags: TagValue[] | undefined;

  try {
    tags = deserialize(value, fieldType);
  } catch (e) {
    tags = undefined;
  }

  const handleAddition = (inputValue: TagValue) => {
    if (!tags) {
      return;
    }

    ctx.setFieldValue(
      ctx.fieldPath,
      serialize([...tags, inputValue], fieldType),
    );
  };

  const handleDelete = (index: number) => {
    if (!tags) {
      return;
    }

    tags.splice(index, 1);
    ctx.setFieldValue(ctx.fieldPath, serialize(tags, fieldType));
  };

  const handleDrag = (
    inputValue: TagValue,
    currPos: number,
    newPos: number,
  ) => {
    if (!tags) {
      return;
    }

    const newValue = [...tags];
    newValue.splice(currPos, 1);
    newValue.splice(newPos, 0, inputValue);

    ctx.setFieldValue(ctx.fieldPath, serialize(newValue, fieldType));
  };

  return (
    <Canvas ctx={ctx}>
      {tags ? (
        <ReactTags
          tags={tags}
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
      ) : (
        <div>
          Invalid value for this plugin! <code>{JSON.stringify(value)}</code>
        </div>
      )}
    </Canvas>
  );
}
