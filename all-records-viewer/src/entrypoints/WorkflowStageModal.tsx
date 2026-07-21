import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, SelectField } from 'datocms-react-ui';
import { useMemo, useState } from 'react';
import type { WorkflowStageOption } from '../types';
import styles from './WorkflowStageModal.module.css';

type Props = {
  ctx: RenderModalCtx;
};

type SelectOption = {
  label: string;
  value: string;
};

function isSelectOption(value: unknown): value is SelectOption {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'label' in value &&
      'value' in value &&
      typeof value.label === 'string' &&
      typeof value.value === 'string',
  );
}

function readStages(value: unknown): WorkflowStageOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('id' in entry) ||
      !('name' in entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.name !== 'string'
    ) {
      return [];
    }

    return [{ id: entry.id, name: entry.name }];
  });
}

export default function WorkflowStageModal({ ctx }: Props) {
  const options = useMemo<SelectOption[]>(
    () =>
      readStages(ctx.parameters.stages).map((stage) => ({
        label: stage.name,
        value: stage.id,
      })),
    [ctx.parameters.stages],
  );
  const [selected, setSelected] = useState<SelectOption | null>(
    options[0] ?? null,
  );
  const count =
    typeof ctx.parameters.count === 'number' ? ctx.parameters.count : 0;

  return (
    <Canvas ctx={ctx}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void ctx.resolve(selected?.value ?? null);
        }}
      >
        <p className={styles.intro}>
          Choose the workflow stage for {count}{' '}
          {count === 1 ? 'record' : 'records'}.
        </p>

        {options.length > 0 ? (
          <SelectField
            id="workflow-stage"
            name="workflow-stage"
            label="Destination stage"
            value={selected}
            onChange={(option) =>
              setSelected(isSelectOption(option) ? option : null)
            }
            selectInputProps={{
              options,
              isClearable: false,
              menuPortalTarget: document.body,
            }}
          />
        ) : (
          <p className={styles.error}>No workflow stages are available.</p>
        )}

        <div className={styles.actions}>
          <Button type="submit" buttonType="primary" disabled={!selected}>
            Continue
          </Button>
          <Button
            type="button"
            buttonType="muted"
            onClick={() => void ctx.resolve(null)}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Canvas>
  );
}
