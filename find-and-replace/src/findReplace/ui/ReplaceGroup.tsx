import { TextInput } from 'datocms-react-ui';
import type { KeyboardEvent } from 'react';
import { IconToggle } from '../../ui/IconToggle';
import { faEraser } from '../../ui/icons';
import type { ReplaceInput } from '../contract';
import { STRINGS } from './copy';

type ReplaceGroupProps = {
  replace: ReplaceInput;
  regex: boolean;
  enabled: boolean;
  showEraser: boolean;
  onTextChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onRemoveChange: (on: boolean) => void;
};

function placeholderFor(replace: ReplaceInput, regex: boolean): string {
  if (replace.remove) {
    return STRINGS.replacePlaceholderRemove;
  }
  return regex ? STRINGS.replacePlaceholderRegex : STRINGS.replacePlaceholder;
}

/**
 * "Replace with…" and the eraser ("Replace with nothing"). With the eraser on,
 * the input is disabled and reads "Matches will be removed"; the typed text is
 * kept and comes back when it's turned off.
 */
export function ReplaceGroup({
  replace,
  regex,
  enabled,
  showEraser,
  onTextChange,
  onKeyDown,
  onRemoveChange,
}: ReplaceGroupProps) {
  return (
    <div className="dl-input-group fr-bar__replace">
      <TextInput
        id="fr-replace"
        type="text"
        value={replace.remove ? '' : replace.text}
        onChange={(value: string) => onTextChange(value)}
        labelText={STRINGS.replaceLabel}
        placeholder={placeholderFor(replace, regex)}
        disabled={!enabled || replace.remove}
        spellCheck={false}
        autoComplete="off"
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => onKeyDown(event)}
      />
      {showEraser && (
        <IconToggle
          glyph={faEraser}
          label={STRINGS.replaceWithNothing}
          pressed={replace.remove}
          disabled={!enabled}
          onChange={onRemoveChange}
        />
      )}
    </div>
  );
}
