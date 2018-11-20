import { SiteClient } from 'datocms-client';
import './style.sass';

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();
  const dato = new SiteClient(plugin.parameters.global.datoCmsApiToken);

  const container = document.createElement('div');
  container.classList.add('container');
  document.body.appendChild(container);
  const title = document.createElement('h4');
  title.textContent = 'Linked content';
  container.appendChild(title);

  const postItemType = Object.values(plugin.itemTypes).find(
    itemType => itemType.attributes.api_key === plugin.parameters.instance.itemTypeApiKey,
  );

  const linkFieldApiKey = plugin.parameters.instance.fieldApiKey;

  const titleFieldId = postItemType.relationshipships.title_field.data.id;
  const titleField = plugin.fields[titleFieldId];

  const query = {
    'filter[type]': postItemType.id,
    [`filter[fields][${linkFieldApiKey}][any_in][]`]: plugin.itemId,
    'page[limit]': 10,
    version: 'current',
  };

  dato.items.all(query)
    .then((items) => {
      items.forEach((item) => {
        const link = document.createElement('a');
        if (titleField.attributes.localized) {
          const firstLocaleWithContent = plugin.site.attributes.locales.find(locale => (
            item[titleFieldApiKey][locale]
          ));
          link.textContent = item[titleField.attributes.api_key][firstLocaleWithContent];
        } else {
          link.textContent = item[titleField.attributes.api_key];
        }

        const url = `/editor/item_types/${postItemTypeId}/items/${item.id}/edit`;

        link.href = url;
        link.target = '_top';
        link.classList.add('link');

        container.appendChild(link);
      });
    })
    .catch((error) => {
      console.log(error);
    });
});
