import { format } from 'date-fns';
import type { ModelBlock } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import { type CSSProperties, useContext, useEffect, useMemo } from 'react';
import { HoverItemContext } from '../../context/HoverItemContext';
import type { Criteria } from '../../types';
import { colorForModel } from '../../utils/colorForModel';
import s from './styles.module.css';
import type { SchemaTypes } from '@datocms/cma-client';

type PropTypes = {
  item: SchemaTypes.Item;
  criteria: Criteria;
};

export default function CalendarItem({ item, criteria }: PropTypes) {
  const ctx = useCtx();
  const { setModelId } = useContext(HoverItemContext);
  const itemType = ctx.itemTypes[
    item.relationships.item_type.data.id
  ] as ModelBlock;
  const titleFieldId = itemType.relationships.title_field.data?.id;

  const color = useMemo(() => colorForModel(itemType.id), [itemType.id]);

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

  const title = !titleField
    ? `Item #${item.id}`
    : titleField.attributes.localized
      ? (
          item.attributes[titleField.attributes.api_key] as Record<
            string,
            string
          >
        )[ctx.site.attributes.locales[0]]
      : (item.attributes[titleField.attributes.api_key] as string);

  return (
    <button
      type="button"
      className={s['item']}
      onClick={() =>
        ctx.navigateTo(
          `/editor/item_types/${itemType.id}/items/${item.id}/edit`,
        )
      }
      style={{ '--color-rgb-components': color.join(', ') } as CSSProperties}
      onMouseOver={() => {
        setModelId(itemType.id);
      }}
      onMouseOut={() => {
        setModelId(null);
      }}
    >
      <div className={s['title']}>
        {title}
        <span className={s['type']}>{itemType.attributes.name}</span>
      </div>
      <div className={s['hour']}>
        {format(new Date(item.meta[criteria] as string), 'HH:mm')}
      </div>
    </button>
  );
}
