import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import NumberInput from 'datocms-react-ui/NumberInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { type FormEvent, useState } from 'react';
import {
  normalizeGlobalParams,
  type ValidGlobalParams,
} from '../../utils/globalParams';

type Props = {
  ctx: RenderConfigScreenCtx;
};

// The kit inputs give null when they are emptied
type Draft = Omit<ValidGlobalParams, 'minFieldsToShow'> & {
  minFieldsToShow: number | null;
};

export default function ConfigScreen({ ctx }: Props) {
  const saved = normalizeGlobalParams(ctx.plugin.attributes.parameters);

  const [draft, setDraft] = useState<Draft>(() =>
    normalizeGlobalParams(ctx.plugin.attributes.parameters),
  );
  const [saving, setSaving] = useState(false);

  const invalid = draft.minFieldsToShow === null;
  const dirty =
    draft.minFieldsToShow !== saved.minFieldsToShow ||
    draft.startOpen !== saved.startOpen;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const { minFieldsToShow } = draft;

    if (!dirty || minFieldsToShow === null || saving) {
      return;
    }

    setSaving(true);

    try {
      await ctx.updatePluginParameters({ ...draft, minFieldsToShow });
      ctx.notice('Settings saved.');
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
          label="Minimum number of fields"
          required
          hint="The “Scroll to field” panel shows only on the records of models with at least this many fields."
          error={invalid ? 'Enter a number.' : undefined}
        >
          <NumberInput
            inputMode="numeric"
            placeholder="5"
            value={draft.minFieldsToShow}
            onChange={(value) => setDraft({ ...draft, minFieldsToShow: value })}
          />
        </FieldWrapper>
        <FieldWrapper>
          <SwitchInput
            label="Panel starts open"
            value={draft.startOpen}
            onChange={(value) =>
              setDraft({ ...draft, startOpen: Boolean(value) })
            }
          />
        </FieldWrapper>
        <Button
          submit
          tone="primary"
          label="Save"
          busy={saving}
          disabled={
            !dirty
              ? { reason: 'There are no changes to save.' }
              : invalid
                ? { reason: 'Enter the minimum number of fields first.' }
                : undefined
          }
        />
      </form>
    </Canvas>
  );
}
