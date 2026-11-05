import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import NumberInput from 'datocms-react-ui/NumberInput';
import StringInput from 'datocms-react-ui/StringInput';
import isEqual from 'lodash-es/isEqual';
import { type FormEvent, useState } from 'react';
import ColorInput from '../components/ColorInput';
import {
  normalizeGlobalParams,
  type ValidGlobalParams,
} from '../utils/globalParams';
import { validateMaxRating, validateStarsColor } from './FieldConfigScreen';

type Props = {
  ctx: RenderConfigScreenCtx;
};

// The kit inputs give null when they are emptied
type Draft = Omit<
  ValidGlobalParams,
  'defaultMaxRating' | 'defaultStarsColor'
> & {
  defaultMaxRating: number | null;
  defaultStarsColor: string | null;
};

export default function ConfigScreen({ ctx }: Props) {
  const saved = normalizeGlobalParams(ctx.plugin.attributes.parameters);

  const [draft, setDraft] = useState<Draft>(() =>
    normalizeGlobalParams(ctx.plugin.attributes.parameters),
  );
  const [saving, setSaving] = useState(false);

  const maxRatingError = validateMaxRating(draft.defaultMaxRating ?? '');
  const starsColorError = validateStarsColor(draft.defaultStarsColor);
  const invalid = Boolean(maxRatingError || starsColorError);
  const dirty = !isEqual(draft, saved);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!dirty || invalid || saving) {
      return;
    }

    setSaving(true);

    try {
      await ctx.updatePluginParameters(draft);
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
          label="Maximum rating"
          required
          hint="From 2 to 10. Each field can set its own."
          error={maxRatingError}
        >
          <NumberInput
            inputMode="numeric"
            placeholder="5"
            value={draft.defaultMaxRating}
            onChange={(value) =>
              setDraft({ ...draft, defaultMaxRating: value })
            }
          />
        </FieldWrapper>
        <FieldWrapper
          label="Stars color"
          required
          hint="The color of the selected stars. Each field can set its own."
          error={starsColorError}
        >
          <ColorInput
            value={draft.defaultStarsColor}
            onChange={(value) =>
              setDraft({ ...draft, defaultStarsColor: value })
            }
          />
        </FieldWrapper>
        <FieldWrapper
          label="Auto-apply to Integer fields with API key"
          labelExtras={{ optional: true }}
          hint="A regular expression. The Integer fields whose API key matches it use the star rating editor."
        >
          <StringInput
            code
            placeholder="star_rating"
            value={draft.autoApplyToFieldsWithApiKey}
            onChange={(value) =>
              setDraft({
                ...draft,
                autoApplyToFieldsWithApiKey: value ?? '',
              })
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
                ? { reason: 'Fix the errors above first.' }
                : undefined
          }
        />
      </form>
    </Canvas>
  );
}
