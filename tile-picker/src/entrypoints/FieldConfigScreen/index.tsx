import type { RenderManualFieldExtensionConfigScreenCtx } from 'datocms-plugin-sdk';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import NumberInput from 'datocms-react-ui/NumberInput';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import StringInput from 'datocms-react-ui/StringInput';
import { useState } from 'react';
import OptionsList, {
  type OptionRow,
  toOption,
  toRow,
} from '../../components/OptionsList';
import type {
  FieldConfig,
  Presentation,
  ValidFieldParameters,
} from '../../lib/types';
import {
  normalizeFieldParameters,
  normalizePluginParameters,
} from '../../lib/types';

type Props = { ctx: RenderManualFieldExtensionConfigScreenCtx };

type State = {
  presets?: string[];
  options: OptionRow[];
  presentation?: Presentation;
};

const LAYOUTS = [
  { value: 'grid', label: 'Grid' },
  { value: 'carousel', label: 'Carousel' },
] as const;

function cleanFieldConfig(state: State): ValidFieldParameters {
  const config: FieldConfig = {};
  if (state.presets?.length) config.presets = state.presets;
  if (state.options.length) config.options = state.options.map(toOption);
  if (state.presentation) {
    const pres: Presentation = {};
    if (state.presentation.type) pres.type = state.presentation.type;
    if (state.presentation.columns != null)
      pres.columns = Number(state.presentation.columns);
    if (state.presentation.width) pres.width = state.presentation.width;
    if (Object.keys(pres).length > 0) config.presentation = pres;
  }
  return { paramsVersion: '2', config };
}

export default function FieldConfigScreen({ ctx }: Props) {
  const [state, setState] = useState<State>(() => {
    const { config } = normalizeFieldParameters(ctx.parameters);
    return { ...config, options: (config.options ?? []).map(toRow) };
  });

  const [presetNames] = useState(() =>
    Object.keys(
      normalizePluginParameters(ctx.plugin.attributes.parameters).presets,
    ),
  );

  // Every change goes to the field at once: the CMS's Save stores it
  const update = (next: State) => {
    setState(next);
    ctx.setParameters(cleanFieldConfig(next));
  };

  const updatePresentation = (changes: Presentation) =>
    update({ ...state, presentation: { ...state.presentation, ...changes } });

  const layout = state.presentation?.type ?? 'grid';

  return (
    <>
      {presetNames.length > 0 && (
        <FieldWrapper
          label="Presets"
          hint="Editors also get the options of these presets, before the ones below."
        >
          <SelectInput
            multiple
            clearable
            options={presetNames.map((name) => ({ value: name, label: name }))}
            // Presets that no longer exist don't show
            value={(state.presets ?? []).filter((name) =>
              presetNames.includes(name),
            )}
            onChange={(presets) => update({ ...state, presets: presets ?? [] })}
          />
        </FieldWrapper>
      )}
      <OptionsList
        value={state.options}
        onChange={(options) => update({ ...state, options })}
      />
      <FieldWrapper label="Layout">
        <RadioGroupInput
          value={layout}
          onChange={(type) => updatePresentation({ type: type ?? undefined })}
          options={LAYOUTS}
        />
      </FieldWrapper>
      {layout === 'grid' ? (
        <FieldWrapper label="Columns">
          <NumberInput
            value={state.presentation?.columns ?? null}
            onChange={(columns) =>
              updatePresentation({ columns: columns ?? undefined })
            }
            placeholder="6"
            inputMode="numeric"
          />
        </FieldWrapper>
      ) : (
        <FieldWrapper label="Tile width">
          <StringInput
            value={state.presentation?.width ?? null}
            onChange={(width) =>
              updatePresentation({ width: width ?? undefined })
            }
            placeholder="250px"
          />
        </FieldWrapper>
      )}
    </>
  );
}
