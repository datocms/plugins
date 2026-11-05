import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import CardList from 'datocms-react-ui/CardList';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import Pill from 'datocms-react-ui/Pill';
import StringInput from 'datocms-react-ui/StringInput';
import isEqual from 'lodash-es/isEqual';
import { type FormEvent, useState } from 'react';
import OptionsList, {
  hasOptionErrors,
  type OptionRow,
  toOption,
  toRow,
} from '../../components/OptionsList';
import lang, { EN_SETTINGS_UPDATED } from '../../lang';
import s from '../../lib/styles.module.css';
import type { Presets } from '../../lib/types';
import { normalizePluginParameters } from '../../lib/types';

type Props = { ctx: RenderConfigScreenCtx };
type PresetEntry = { name: string; options: OptionRow[] };

function presetsToDraft(presets: Presets): PresetEntry[] {
  return Object.entries(presets).map(([name, options]) => ({
    name,
    options: options.map(toRow),
  }));
}

// Presets without a name are skipped; a repeated name keeps the last one
function draftToPresets(draft: PresetEntry[]): Presets {
  return Object.fromEntries(
    draft
      .filter((preset) => preset.name)
      .map((preset) => [preset.name, preset.options.map(toOption)]),
  );
}

const isIncomplete = (preset: PresetEntry) =>
  !preset.name.trim() || hasOptionErrors(preset.options);

export default function GlobalConfigScreen({ ctx }: Props) {
  const savedPresets = normalizePluginParameters(
    ctx.plugin.attributes.parameters,
  ).presets;
  const [draft, setDraft] = useState(() => presetsToDraft(savedPresets));
  const [openPresets, setOpenPresets] = useState<Set<number>>(() => new Set());
  const [saving, setSaving] = useState(false);

  // Compared with the saved parameters of each render, so it clears once the
  // host passes the saved ones back
  const dirty = !isEqual(draft, presetsToDraft(savedPresets));
  const invalid = draft.some(isIncomplete);

  const updatePreset = (index: number, changes: Partial<PresetEntry>) =>
    setDraft(
      draft.map((preset, i) =>
        i === index ? { ...preset, ...changes } : preset,
      ),
    );

  const togglePreset = (index: number) => {
    const next = new Set(openPresets);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setOpenPresets(next);
  };

  const removePreset = (index: number) => {
    setDraft(draft.filter((_, i) => i !== index));
    // The open presets after the removed one move up by one
    const next = new Set<number>();
    for (const i of openPresets) {
      if (i < index) next.add(i);
      else if (i > index) next.add(i - 1);
    }
    setOpenPresets(next);
  };

  // A new preset opens, to be named
  const addPreset = {
    label: 'Add preset',
    onClick: () => {
      setDraft([...draft, { name: '', options: [] }]);
      setOpenPresets(new Set([...openPresets, draft.length]));
    },
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty || invalid || saving) return;
    setSaving(true);
    try {
      await ctx.updatePluginParameters({
        paramsVersion: '2',
        presets: draftToPresets(draft),
      });
      ctx.notice(lang(EN_SETTINGS_UPDATED));
    } finally {
      setSaving(false);
    }
  };

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the section starts the frame, with no
  // Page around it. One form spans the list, so Save follows it
  return (
    <form onSubmit={handleSubmit}>
      <Page.Section className={s.lastSection}>
        <Page.SectionDescription>
          Presets are named sets of options that many fields can share. A field
          that uses a preset shows its options before its own.
        </Page.SectionDescription>
        <CardList
          add={addPreset}
          empty={<EmptySlot message="No presets yet" action={addPreset} />}
        >
          {draft.map((preset, index) => (
            <CardList.Item
              // biome-ignore lint/suspicious/noArrayIndexKey: presets have no id, and names can be empty or repeat
              key={index}
              row={{
                summary: preset.name || `Preset ${index + 1}`,
                trailing: isIncomplete(preset) ? (
                  <Pill tone="danger">Incomplete</Pill>
                ) : undefined,
                actions: (
                  <CardList.RemoveButton
                    label="Remove preset"
                    onClick={() => removePreset(index)}
                  />
                ),
              }}
              expandable={{
                open: openPresets.has(index),
                onToggle: () => togglePreset(index),
                body: (
                  <>
                    <FieldWrapper
                      label="Name"
                      required
                      error={preset.name.trim() ? undefined : 'Enter a name'}
                    >
                      <StringInput
                        value={preset.name}
                        onChange={(name) =>
                          updatePreset(index, { name: name ?? '' })
                        }
                        placeholder="Brand colors"
                      />
                    </FieldWrapper>
                    <OptionsList
                      value={preset.options}
                      onChange={(options) => updatePreset(index, { options })}
                    />
                  </>
                ),
              }}
            />
          ))}
        </CardList>
      </Page.Section>
      <Button
        submit
        tone="primary"
        label="Save"
        busy={saving}
        disabled={
          !dirty
            ? { reason: 'There are no changes to save.' }
            : invalid
              ? { reason: 'Fill in the required fields first.' }
              : undefined
        }
      />
    </form>
  );
}
