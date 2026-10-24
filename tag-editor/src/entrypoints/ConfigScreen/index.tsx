import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import SelectInput from 'datocms-react-ui/SelectInput';
import TableList, {
  type TableListColumn,
  type TableListRowTouched,
} from 'datocms-react-ui/TableList';
import isEqual from 'lodash-es/isEqual';
import { type FormEvent, useMemo, useState } from 'react';
import {
  type AutoApplyRule,
  type Config,
  normalizeParams,
  type ValidFieldType,
} from '../../types';

type Props = {
  ctx: RenderConfigScreenCtx;
};

type FieldTypeChoice = 'string' | 'json' | 'both';

const FIELD_TYPE_CHOICES: { value: FieldTypeChoice; label: string }[] = [
  { value: 'string', label: 'Single-line string' },
  { value: 'json', label: 'JSON' },
  { value: 'both', label: 'Single-line string or JSON' },
];

// The stored rule keeps a list of field types: the select shows it as one
// choice of three
function toChoice(fieldTypes: ValidFieldType[]): FieldTypeChoice | null {
  const hasString = fieldTypes.includes('string');
  const hasJson = fieldTypes.includes('json');

  if (hasString && hasJson) {
    return 'both';
  }

  if (hasString) {
    return 'string';
  }

  if (hasJson) {
    return 'json';
  }

  return null;
}

function fromChoice(choice: string | null): ValidFieldType[] {
  switch (choice) {
    case 'both':
      return ['string', 'json'];
    case 'string':
      return ['string'];
    case 'json':
      return ['json'];
    default:
      return [];
  }
}

function isValidRegExp(pattern: string): boolean {
  try {
    return new RegExp(pattern) instanceof RegExp;
  } catch (_e) {
    return false;
  }
}

type RuleErrors = {
  fieldTypes?: string;
  apiKeyRegexp?: string;
};

function validateRule(rule: AutoApplyRule): RuleErrors {
  const errors: RuleErrors = {};

  if (rule.fieldTypes.length === 0) {
    errors.fieldTypes = 'Pick a field type';
  }

  if (!rule.apiKeyRegexp) {
    errors.apiKeyRegexp = 'Enter an API key pattern';
  } else if (!isValidRegExp(rule.apiKeyRegexp)) {
    errors.apiKeyRegexp = 'Enter a valid regular expression';
  }

  return errors;
}

const newRule = (): AutoApplyRule => ({ fieldTypes: [], apiKeyRegexp: '' });

export default function ConfigScreen({ ctx }: Props) {
  const saved = normalizeParams(ctx.plugin.attributes.parameters as Config);

  const [rules, setRules] = useState<AutoApplyRule[]>(saved.autoApplyRules);
  const [touched, setTouched] = useState<(TableListRowTouched | undefined)[]>(
    [],
  );
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = !isEqual(rules, saved.autoApplyRules);
  const errors = rules.map(validateRule);
  const valid = errors.every(
    (rowErrors) => !rowErrors.fieldTypes && !rowErrors.apiKeyRegexp,
  );

  const columns = useMemo<TableListColumn<AutoApplyRule>[]>(
    () => [
      {
        id: 'fieldTypes',
        field: 'fieldTypes',
        label: 'Field type',
        // The class of the cell input is for a text input: the select does
        // not take it
        render: ({
          index,
          value,
          onChange,
          onBlur,
          inputProps: { className: _, ...inputProps },
        }) => {
          const currentChoice = toChoice(Array.isArray(value) ? value : []);

          return (
            <SelectInput
              {...inputProps}
              name={`fieldTypes-${index}`}
              value={currentChoice}
              onChange={(choice) => {
                // Picking the selected choice again also calls onChange: the
                // rule keeps its stored array, in its order
                if (choice !== currentChoice) {
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
          );
        },
      },
      {
        id: 'apiKeyRegexp',
        field: 'apiKeyRegexp',
        label: 'API key pattern',
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
        paramsVersion: '2',
      });
      ctx.notice('Settings saved.');
      setSubmitAttempted(false);
      setTouched([]);
    } catch (_e) {
      ctx.alert('The settings could not be saved.');
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
              hint="A field that matches one of these rules uses the tag editor. The pattern is a regular expression tested on the field's API key."
            >
              <TableList<AutoApplyRule>
                value={rules}
                onChange={(nextRules, change) => {
                  setRules(nextRules);
                  // The touched state follows the rows
                  if (change.type === 'remove') {
                    setTouched((rows) =>
                      rows.filter((_row, i) => i !== change.index),
                    );
                  }
                }}
                errors={errors}
                touched={submitAttempted ? true : touched}
                onCellBlur={({ index, field }) =>
                  setTouched((rows) => {
                    // Dense, so a remove keeps the other rows in step
                    const nextRows = Array.from(
                      { length: Math.max(rows.length, index + 1) },
                      (_row, i) => rows[i],
                    );
                    const row = nextRows[index];
                    nextRows[index] = {
                      ...(typeof row === 'object' ? row : {}),
                      [field]: true,
                    };
                    return nextRows;
                  })
                }
                columns={columns}
                emptyMessage="No rules yet"
                add={{ label: 'Add rule', newItem: newRule }}
              />
            </FieldWrapper>
          </Page.Group>
        </form>
      </Page.Content>
    </Page>
  );
}
