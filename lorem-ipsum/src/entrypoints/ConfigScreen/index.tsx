import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import SelectInput from 'datocms-react-ui/SelectInput';
import TableList, { type TableListColumn } from 'datocms-react-ui/TableList';
import { type FormEvent, useMemo, useState } from 'react';
import type { AutoApplyRule, Config, ValidFieldType } from '../../types';

type Props = {
  ctx: RenderConfigScreenCtx;
};

// The field types the plugin can fill
const FIELD_TYPES: { value: ValidFieldType; label: string }[] = [
  { value: 'string', label: 'Single-line string' },
  { value: 'text', label: 'Multi-line text' },
  { value: 'structured_text', label: 'Structured text' },
];

export default function ConfigScreen({ ctx }: Props) {
  const { autoApplyRules } = ctx.plugin.attributes.parameters as Config;
  const savedRules = Array.isArray(autoApplyRules) ? autoApplyRules : [];

  const [rules, setRules] = useState<AutoApplyRule[]>(savedRules);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(rules) !== JSON.stringify(savedRules);
  const errors = rules.map((rule) => ({
    fieldTypes:
      rule.fieldTypes.length === 0 ? 'Pick at least one field type' : undefined,
    apiKeyRegexp: rule.apiKeyRegexp ? undefined : 'Enter an API key pattern',
  }));
  const valid = errors.every(
    (rowErrors) => !rowErrors.fieldTypes && !rowErrors.apiKeyRegexp,
  );

  const columns = useMemo<TableListColumn<AutoApplyRule>[]>(
    () => [
      {
        id: 'fieldTypes',
        field: 'fieldTypes',
        label: 'Field types',
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
            multiple
            name={`fieldTypes-${index}`}
            value={item.fieldTypes}
            onChange={(values) => onChange(values ?? [])}
            onBlur={() => onBlur()}
            options={FIELD_TYPES}
            placeholder="Pick field types"
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
        ...ctx.plugin.attributes.parameters,
        autoApplyRules: rules,
      });
      ctx.notice('Settings saved.');
      setSubmitAttempted(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <Page.Content>
        <form onSubmit={handleSubmit}>
          <Page.Group
            title="Automatic rules"
            footer={
              <Button
                submit
                tone="primary"
                expand={false}
                label="Save"
                busy={saving}
                disabled={
                  dirty
                    ? undefined
                    : { reason: 'There are no changes to save.' }
                }
              />
            }
          >
            <FieldWrapper
              label="Automatic rules"
              labelExtras={{ hidden: true }}
              hint="A field that matches one of these rules gets the “Generate dummy text” action, also without the add-on. The pattern is a regular expression tested on the field's API key."
            >
              <TableList<AutoApplyRule>
                value={rules}
                onChange={setRules}
                errors={errors}
                touched={submitAttempted}
                columns={columns}
                emptyMessage="No rules yet"
                add={{
                  label: 'Add rule',
                  newItem: () => ({ fieldTypes: [], apiKeyRegexp: '' }),
                }}
              />
            </FieldWrapper>
          </Page.Group>
        </form>
      </Page.Content>
    </Page>
  );
}
