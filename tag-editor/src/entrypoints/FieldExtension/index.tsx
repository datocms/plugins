import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import SelectInput from 'datocms-react-ui/SelectInput';
import get from 'lodash-es/get';
import type { ClipboardEvent } from 'react';
import {
  deserialize,
  type FieldType,
  mergeTags,
  serialize,
} from '../../utils/tags';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

const EXPECTED_FORMAT: Record<FieldType, string> = {
  json: 'It needs a JSON array of strings, like ["news", "sport"].',
  string: 'It needs a comma-separated text, like news, sport.',
};

function readTags(value: unknown, fieldType: FieldType): string[] | null {
  try {
    return deserialize(value, fieldType);
  } catch (_e) {
    return null;
  }
}

function noOptionsMessage() {
  return null;
}

// A prop of the creatable react-select, which SelectInput passes through
// although its props type doesn't list it
type CreateGuard = {
  isValidNewOption: (inputValue: string) => boolean;
};

export default function FieldExtension({ ctx }: Props) {
  const fieldType = ctx.field.attributes.field_type as FieldType;
  const value: unknown = get(ctx.formValues, ctx.fieldPath);
  const tags = readTags(value, fieldType);

  if (!tags) {
    return (
      <>
        <Callout tone="danger" title="The tag editor can't read this value">
          {EXPECTED_FORMAT[fieldType]}
        </Callout>
        <CodeSnippet
          code={
            typeof value === 'string' ? value : JSON.stringify(value, null, 2)
          }
          ariaLabel="Current value"
          maxHeight={200}
        />
      </>
    );
  }

  // A value edited outside the editor can hold a tag twice. Each pill is one
  // tag, so the editor shows and writes each tag once, as it never adds a
  // tag twice either
  const uniqueTags = Array.from(new Set(tags));

  const write = (nextTags: string[]) => {
    ctx.setFieldValue(ctx.fieldPath, serialize(nextTags, fieldType));
  };

  const addTags = (texts: string[]) => {
    const nextTags = mergeTags(uniqueTags, texts);

    if (nextTags.length > uniqueTags.length) {
      write(nextTags);
    }
  };

  // A paste always becomes tags, one for each line or tab-separated piece,
  // and never lands in the input as text
  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (ctx.disabled) {
      return;
    }

    const text = event.clipboardData.getData('text');
    event.preventDefault();
    addTags(text.split(/[\r\n\t]+/));
  };

  const options = uniqueTags.map((tag) => ({ value: tag, label: tag }));

  // The create option shows only for a text that adds a tag once trimmed:
  // not for blank text, nor for a tag that is already there
  const createGuard: CreateGuard = {
    isValidNewOption: (inputValue) =>
      mergeTags(uniqueTags, [inputValue]).length > uniqueTags.length,
  };

  return (
    <div onPasteCapture={handlePaste}>
      <SelectInput
        {...createGuard}
        aria-label={ctx.field.attributes.label}
        name={ctx.fieldPath}
        multiple
        value={uniqueTags}
        options={options}
        onChange={(nextTags) => write(nextTags ?? [])}
        creatable={{ onCreate: (text) => addTags([text]) }}
        // Every option is a selected tag, and a multiple select hides the
        // selected options: the menu opens only to create a tag
        noOptionsMessage={noOptionsMessage}
        placeholder="Add a tag"
        // A multiple select clears all its values unless told otherwise:
        // each tag has its own cross instead
        clearable={false}
        disabled={ctx.disabled}
      />
    </div>
  );
}
