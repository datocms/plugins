import type { RenderModalCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import { type FormEvent, useMemo, useState } from 'react';
import { ListCheckIcon } from '../icons';
import { TEXTS } from '../texts';
import type { WorkflowStageOption } from '../types';
import { useFrameSizedToContent } from '../utils/frame';
import s from './WorkflowStageModal.module.css';

// The stage picker of the stage pages built before the selection bar had its
// "Move to stage" menu: they open it with ctx.openModal({ parameters: { count,
// stages } }) and wait for the id of the chosen stage, or null.

type Props = {
  ctx: RenderModalCtx;
};

type StageOption = {
  label: string;
  value: string;
};

// Radios show every option at once, from two to five; a longer list is a
// select, and a single stage is no choice, thus a sentence names it
const MAX_RADIO_OPTIONS = 5;

function onlyStageSentence(
  locale: string,
  count: number,
  stage: string,
): string {
  const target = `the stage “${stage}”`;
  if (count === 0) {
    return `The selected records move to ${target}.`;
  }
  if (new Intl.PluralRules(locale).select(count) === 'one') {
    return `The selected record moves to ${target}.`;
  }
  const number = new Intl.NumberFormat(locale).format(count);
  return `The ${number} selected records move to ${target}.`;
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

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export default function WorkflowStageModal({ ctx }: Props) {
  useFrameSizedToContent();
  const options = useMemo<StageOption[]>(
    () =>
      readStages(ctx.parameters.stages).map((stage) => ({
        label: stage.name,
        value: stage.id,
      })),
    [ctx.parameters.stages],
  );
  const [selected, setSelected] = useState<string | null>(
    options[0]?.value ?? null,
  );
  const count = readCount(ctx.parameters.count);
  const selectedStage = options.some((option) => option.value === selected)
    ? selected
    : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedStage) {
      void ctx.resolve(selectedStage);
    }
  }

  const cancel = (
    <Button tone="ghost" label="Cancel" onClick={() => ctx.resolve(null)} />
  );

  return (
    <Canvas ctx={ctx} texts={TEXTS}>
      {options.length === 0 ? (
        <>
          <BlankSlate
            placement="inline"
            small
            icon={<ListCheckIcon />}
            title="No stages to move to"
            description="The workflow has no other stage to move the records to."
          />
          <div className={s.footer}>{cancel}</div>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          {options.length === 1 ? (
            <p className={s.text}>
              {onlyStageSentence(ctx.ui.locale, count, options[0]?.label ?? '')}
            </p>
          ) : (
            <FieldWrapper
              label="Stage"
              hint={
                count > 0
                  ? { id: 'stageViewer.moveHint', values: { count } }
                  : undefined
              }
            >
              {options.length <= MAX_RADIO_OPTIONS ? (
                <RadioGroupInput
                  value={selectedStage}
                  onChange={setSelected}
                  options={options}
                />
              ) : (
                <SelectInput
                  value={selectedStage}
                  onChange={setSelected}
                  options={options}
                  clearable={false}
                />
              )}
            </FieldWrapper>
          )}
          <div className={s.footer}>
            {cancel}
            <Button
              tone="primary"
              submit
              label="Continue"
              disabled={
                selectedStage ? undefined : { reason: 'Choose a stage first.' }
              }
            />
          </div>
        </form>
      )}
    </Canvas>
  );
}
