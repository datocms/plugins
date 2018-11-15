import { SiteClient } from 'datocms-client';
import './style.sass';

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();
  const dato = new SiteClient(plugin.parameters.global.datoCmsApiKey);
  // const dato = new SiteClient(plugin.parameters.global.datoCmsApiKey, {}, 'http://site-api.lvh.me:3001/');
  const siteLocale = plugin.site.attributes.locales[0];

  const container = document.createElement('div');
  container.classList.add('container');
  document.body.appendChild(container);
  const title = document.createElement('h4');
  title.textContent = 'Linked content';
  container.appendChild(title);

  const postItemTypeId = Object.keys(plugin.itemTypes).find(
    id => plugin.itemTypes[id].attributes.api_key === plugin.parameters.instance.itemTypeApiKey,
  );

  const postItemId = plugin.itemId;
  const linkFieldApiKey = plugin.parameters.instance.fieldApiKey;

  const titleFieldId = plugin.itemTypes[postItemTypeId].relationships.title_field.data.id;
  let [titleFieldApiKey, titleFieldisLocalized] = ['', false];

  dato.fields.find(titleFieldId)
    .then((field) => {
      titleFieldApiKey = field.apiKey;
      titleFieldisLocalized = field.localized;
    })
    .catch((error) => {
      console.log(error);
    });

  const query = {
    'filter[type]': postItemTypeId,
    [`filter[fields][${linkFieldApiKey}][any_in][]`]: postItemId,
    'page[offset]': 0,
    version: 'current',
  };

  dato.items.all(query)
    .then((items) => {
      items.forEach((item) => {
        const link = document.createElement('a');
        if (titleFieldisLocalized) {
          link.textContent = item[titleFieldApiKey][siteLocale];
        } else {
          link.textContent = item[titleFieldApiKey];
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
