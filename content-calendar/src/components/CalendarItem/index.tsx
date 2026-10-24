import type { SchemaTypes } from '@datocms/cma-client';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui/Canvas';
import { useDateSettings } from 'datocms-react-ui/DateSettings';
import IdText from 'datocms-react-ui/IdText';
import Link from 'datocms-react-ui/Link';
import { formatTime } from 'datocms-react-ui/utils/formatDate';
import { type CSSProperties, useContext, useEffect } from 'react';
import { HoverItemContext } from '../../context/HoverItemContext';
import type { Criteria } from '../../types';
import { colorForModel } from '../../utils/colorForModel';
import s from './styles.module.css';

type PropTypes = {
  item: SchemaTypes.Item;
  criteria: Criteria;
};

export default function CalendarItem({ item, criteria }: PropTypes) {
  const ctx = useCtx<RenderPageCtx>();
  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  const { setModelId } = useContext(HoverItemContext);
  const dateSettings = useDateSettings();
  const itemType = ctx.itemTypes[
    item.relationships.item_type.data.id
  ] as SchemaTypes.ItemType;
  const titleFieldId = itemType.relationships.title_field.data?.id;

  useEffect(() => {
    if (!titleFieldId) {
      return;
    }

    if (ctx.fields[titleFieldId]) {
      return;
    }

    ctx.loadItemTypeFields(itemType.id);
  }, [titleFieldId, itemType.id, ctx]);

  const titleField = titleFieldId && ctx.fields[titleFieldId];

  const titleValue = !titleField
    ? undefined
    : titleField.attributes.localized
      ? (
          item.attributes[titleField.attributes.api_key] as
            | Record<string, string | null>
            | null
            | undefined
        )?.[ctx.site.attributes.locales[0]]
      : (item.attributes[titleField.attributes.api_key] as
          | string
          | null
          | undefined);

  // With no title (no title field, an empty value, or the field still
  // loading), the ID tells the record apart from the others of its model
  const title =
    typeof titleValue === 'string' && titleValue.trim() !== '' ? (
      titleValue
    ) : (
      <>
        Record <IdText id={item.id} />
      </>
    );

  const value = item.meta[criteria] as string;

  return (
    <Link
      to={`${environmentPrefix}/editor/item_types/${itemType.id}/items/${item.id}/edit`}
      className={s.item}
      style={{ '--model-color': colorForModel(itemType.id) } as CSSProperties}
      onMouseEnter={() => setModelId(itemType.id)}
      onMouseLeave={() => setModelId(null)}
      onFocus={() => setModelId(itemType.id)}
      onBlur={() => setModelId(null)}
    >
      {/* The title, then the name of the model, on one line with one ellipsis,
          so a day shows many records at a glance. The name of the model stays
          in the name of the link when the line cuts it. The spaces keep the
          words apart. */}
      <span className={s.text}>
        {title} <span className={s.model}>{itemType.attributes.name}</span>
      </span>{' '}
      {/* The time is in the time zone of the browser, as the day the record
          sits on (see CalendarGrid), with the 12 or 24 hour clock of the
          user. */}
      <time className={s.time} dateTime={value}>
        {formatTime(value, {
          ...dateSettings,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })}
      </time>
    </Link>
  );
}
