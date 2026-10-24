import type { RenderModalCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import RawButton from 'datocms-react-ui/RawButton';
import StringInput from 'datocms-react-ui/StringInput';
import { useMemo, useState } from 'react';
import {
  ICON_RESULTS_LIMIT,
  iconByName,
  SearchIcon,
  searchIconNames,
} from '../../../icons';
import { useFrameSizedToContent } from '../../../utils/frame';
import s from './modal-styles.module.css';

function IconTile({
  name,
  current,
  onPick,
}: {
  name: string;
  current: boolean;
  onPick: (name: string) => void;
}) {
  const Glyph = iconByName(name);

  return (
    <RawButton
      className={s.tile}
      current={current ? 'true' : undefined}
      onClick={() => onPick(name)}
    >
      {Glyph && <Glyph />}
      <span className={s.name}>{name}</span>
    </RawButton>
  );
}

/**
 * The modal that picks the icon of a viewport, by its name. The settings
 * now pick the icon in its cell of the list; the modal id 'iconPicker' stays
 * registered, so a caller that opens it still gets a name back.
 */
export function IconPickerModal({ ctx }: { ctx: RenderModalCtx }) {
  useFrameSizedToContent();
  const [query, setQuery] = useState<string | null>('');
  const searchQuery = query ?? '';
  const currentValue =
    typeof ctx.parameters.currentValue === 'string'
      ? ctx.parameters.currentValue
      : '';

  const matches = useMemo(() => searchIconNames(searchQuery), [searchQuery]);

  const shownIcons = matches.slice(0, ICON_RESULTS_LIMIT);
  const count = matches.length;

  return (
    <>
      <FieldWrapper
        label="Search icons"
        labelExtras={{ hidden: true }}
        hint={
          count > ICON_RESULTS_LIMIT
            ? {
                id: 'webPreviews.iconCountCapped',
                values: { count, limit: ICON_RESULTS_LIMIT },
              }
            : { id: 'webPreviews.iconCount', values: { count } }
        }
      >
        <StringInput
          // The modal opens to search: its only input takes the focus
          autoFocus
          placeholder="mobile"
          value={query}
          onChange={setQuery}
        />
      </FieldWrapper>
      {shownIcons.length > 0 ? (
        <div className={s.grid}>
          {shownIcons.map((iconName) => (
            <IconTile
              key={iconName}
              name={iconName}
              current={iconName === currentValue}
              onPick={(name) => ctx.resolve(name)}
            />
          ))}
        </div>
      ) : (
        // The search field is above it: a frame sets it apart (section)
        <BlankSlate
          placement="section"
          small
          icon={<SearchIcon />}
          title={`No icons match “${searchQuery}”`}
        />
      )}
    </>
  );
}
