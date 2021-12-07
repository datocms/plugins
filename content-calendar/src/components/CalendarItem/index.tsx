import { format } from 'date-fns';
import { Item, ModelBlock } from 'datocms-plugin-sdk';
import { useEffect } from 'react';
import { useDatoContext } from '../../utils/useDatoContext';
import s from './styles.module.css';

type PropTypes = {
  item: Item;
};

export default function CalendarItem({ item }: PropTypes) {
  const ctx = useDatoContext();
  const itemType = ctx.itemTypes[
    item.relationships.item_type.data.id
  ] as ModelBlock;
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

  const title = !titleField
    ? `Item #${item.id}`
    : titleField.attributes.localized
    ? (
        item.attributes[titleField.attributes.api_key] as Record<string, string>
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
    >
      <div className={s['left']}>
        <div className={s['type']}>{itemType.attributes.name}</div>
        <div className={s['title']}>{title}</div>
      </div>

      <div className={s['hour']}>
        {format(
          new Date(item.meta.publication_scheduled_at as string),
          'HH:mm',
        )}
      </div>
    </button>
  );
}
