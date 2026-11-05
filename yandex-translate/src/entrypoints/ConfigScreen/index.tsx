import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SelectInput from 'datocms-react-ui/SelectInput';
import StringInput from 'datocms-react-ui/StringInput';
import TableList, { type TableListColumn } from 'datocms-react-ui/TableList';
import isEqual from 'lodash-es/isEqual';
import { type FormEvent, useMemo, useState } from 'react';
import {
  type AutoApplyRule,
  normalizeParams,
  type ValidFieldType,
} from '../../types';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type FieldTypeChoice = ValidFieldType | 'both';

const FIELD_TYPE_CHOICES: { value: FieldTypeChoice; label: string }[] = [
  { value: 'string', label: 'Single-line string' },
  { value: 'text', label: 'Multi-line text' },
  { value: 'both', label: 'Single-line string or multi-line text' },
];

// The stored rule keeps a list of field types: the select shows it as one
// choice of three
function toChoice(fieldTypes: ValidFieldType[]): FieldTypeChoice | null {
  if (fieldTypes.includes('string') && fieldTypes.includes('text')) {
    return 'both';
  }

  return fieldTypes[0] ?? null;
}

function fromChoice(choice: string | null): ValidFieldType[] {
  switch (choice) {
    case 'both':
      return ['string', 'text'];
    case 'string':
    case 'text':
      return [choice];
    default:
      return [];
  }
}

export default function ConfigScreen({ ctx }: Props) {
  const saved = normalizeParams(ctx.plugin.attributes.parameters);

  const [apiKey, setApiKey] = useState<string | null>(saved.yandexApiKey);
  const [rules, setRules] = useState<AutoApplyRule[]>(saved.autoApplyRules);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty =
    (apiKey ?? '') !== saved.yandexApiKey ||
    !isEqual(rules, saved.autoApplyRules);
  const apiKeyError = apiKey ? undefined : 'Enter a Yandex API key';
  const ruleErrors = rules.map((rule) => ({
    fieldTypes: rule.fieldTypes.length === 0 ? 'Pick a field type' : undefined,
    apiKeyRegexp: rule.apiKeyRegexp ? undefined : 'Enter an API key pattern',
  }));
  const valid =
    !apiKeyError &&
    ruleErrors.every((errors) => !errors.fieldTypes && !errors.apiKeyRegexp);

  const columns = useMemo<TableListColumn<AutoApplyRule>[]>(
    () => [
      {
        id: 'fieldTypes',
        field: 'fieldTypes',
        label: 'Field type',
        grow: 3,
        // The class of the cell input is for a text input: the select does
        // not take it
        render: ({
          item,
          index,
          onChange,
          onBlur,
          inputProps: { className: _, ...inputProps },
        }) => (
          <SelectInput
            {...inputProps}
            name={`fieldTypes-${index}`}
            value={toChoice(item.fieldTypes)}
            onChange={(choice) => {
              // Picking the current choice again keeps the stored array
              if (choice !== toChoice(item.fieldTypes)) {
                onChange(fromChoice(choice));
              }
            }}
            onBlur={() => onBlur()}
            options={FIELD_TYPE_CHOICES}
            placeholder="Pick a field type"
            clearable={false}
            variant="embedded"
            classNamePrefix="TableList__select"
          />
        ),
      },
      {
        id: 'apiKeyRegexp',
        field: 'apiKeyRegexp',
        label: 'API key pattern',
        grow: 2,
        code: true,
      },
    ],
    [],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!dirty || saving) {
      return;
    }

    if (!valid) {
      setSubmitAttempted(true);
      return;
    }

    setSaving(true);

    try {
      await ctx.updatePluginParameters({
        ...saved,
        yandexApiKey: apiKey ?? '',
        autoApplyRules: rules,
      });
      ctx.notice('Settings saved.');
      setSubmitAttempted(false);
    } finally {
      setSaving(false);
    }
  };

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the fields start the frame, with no
  // Page around them
  return (
    <Canvas ctx={ctx}>
      <form onSubmit={handleSubmit}>
        <FieldWrapper
          label="Yandex API key"
          required
          error={submitAttempted ? apiKeyError : undefined}
          docs={{
            label: 'Yandex Translate API',
            to: 'https://tech.yandex.com/translate/',
          }}
        >
          <StringInput code value={apiKey} onChange={setApiKey} />
        </FieldWrapper>
        <FieldWrapper
          label="Automatic rules"
          hint="A localized field that matches one of these rules gets the translate button. The pattern is a regular expression tested on the field's API key."
        >
          <TableList<AutoApplyRule>
            value={rules}
            onChange={setRules}
            errors={ruleErrors}
            touched={submitAttempted}
            columns={columns}
            emptyMessage="No rules yet"
            add={{
              label: 'Add rule',
              newItem: () => ({ fieldTypes: [], apiKeyRegexp: '' }),
            }}
          />
        </FieldWrapper>
        <Button
          submit
          tone="primary"
          label="Save"
          busy={saving}
          disabled={
            dirty ? undefined : { reason: 'There are no changes to save.' }
          }
        />
      </form>
    </Canvas>
  );
}
