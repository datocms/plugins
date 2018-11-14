import { SiteClient } from 'datocms-client';
import './style.sass';

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();

  const title = document.createElement('h4');
  title.textContent = 'Linked content';
  const container = document.createElement('div');
  container.classList.add('container');
  document.body.appendChild(container);
  container.appendChild(title);

  const dato = new SiteClient(plugin.parameters.global.datoCmsApiKey, {}, 'http://site-api.lvh.me:3001/');

  const itemTypeId = Object.keys(plugin.itemTypes).find(
    id => plugin.itemTypes[id].attributes.api_key === plugin.parameters.instance.itemTypeApiKey,
  );

  const query = {
    'filter[type]': itemTypeId,
    [`filter[fields][${plugin.parameters.instance.fieldApiKey}][any_in][]`]: 432298,
    'page[offset]': 0,
    version: 'current',
  };

  dato.items.all(query)
    .then((items) => {
      items.forEach((item) => {
        const link = document.createElement('a');
        link.textContent = item.name;
        const url = `https://${plugin.site.attributes.internal_domain}/editor/item_types/${itemTypeId}/items/${item.id}/edit`;
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
