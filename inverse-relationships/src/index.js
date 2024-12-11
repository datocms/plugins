import { SiteClient } from 'datocms-client';
import './style.sass';

window.DatoCmsPlugin.init(async (plugin) => {
  plugin.startAutoResizer();

  const dato = new SiteClient(plugin.parameters.global.datoCmsApiToken, {
    environment: plugin.environment,
  });

  const container = document.createElement('div');
  container.classList.add('container');
  document.body.appendChild(container);

  const linkItemType = Object.values(plugin.itemTypes).find(
    itemType => itemType.attributes.api_key === plugin.parameters.instance.itemTypeApiKey,
  );

  if (!linkItemType) {
    const error = document.createElement('p');
    error.textContent = 'Please insert a valid Model ID in your field settings';
    error.classList.add('error');
    container.appendChild(error);
    return;
  }

  const findLinkingFields = fields => fields.find(
    field => field.relationships.item_type.data.id === linkItemType.id
        && field.attributes.api_key === plugin.parameters.instance.fieldApiKey,
  );

  let linkField = findLinkingFields(Object.values(plugin.fields));

  if (!linkField) {
    const loadedFields = await plugin.loadItemTypeFields(linkItemType.id);
    linkField = findLinkingFields(loadedFields);
    if (!linkField) {
      const error = document.createElement('p');
      error.textContent = 'Please insert a valid field ID in your field settings';
      error.classList.add('error');
      container.appendChild(error);
    }
  }

  const titleFieldId = linkItemType.relationships.title_field.data
    && linkItemType.relationships.title_field.data.id;

  const filter = linkField.attributes.field_type === 'link'
    ? `filter[fields][${linkField.attributes.api_key}][eq]`
    : `filter[fields][${linkField.attributes.api_key}][any_in][]`;

  const query = {
    'filter[type]': linkItemType.id,
    [filter]: plugin.itemId,
    order_by: plugin.parameters.instance.orderBy,
    'page[limit]': plugin.parameters.instance.limit,
    version: 'current',
  };

  dato.items
    .all(query)
    .then((items) => {
      items.forEach((item) => {
        const link = document.createElement('a');
        const path = `/editor/item_types/${linkItemType.id}/items/${item.id}/edit`;

        let linkLabel;

        if (titleFieldId) {
          const titleField = plugin.fields[titleFieldId];
          if (titleField.attributes.localized) {
            const firstLocaleWithContent = plugin.site.attributes.locales.find(
              locale => item[titleField.attributes.api_key][locale],
            );
            linkLabel = item[titleField.attributes.api_key][firstLocaleWithContent];
          } else {
            linkLabel = item[titleField.attributes.api_key];
          }
        } else {
          linkLabel = `Record#${item.id}`;
        }

        link.textContent = linkLabel;
        link.href = '#';
        link.classList.add('link');

        link.addEventListener('click', (e) => {
          e.preventDefault();
          plugin.navigateTo(path);
        });

        container.appendChild(link);
      });
    })
    .catch((error) => {
      console.log(error);
    });
});
