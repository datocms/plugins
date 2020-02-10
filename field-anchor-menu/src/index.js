import './style.sass';

window.DatoCmsPlugin.init((plugin) => {
  plugin.startAutoResizer();
  const { itemType } = plugin;
  const container = document.createElement('div');
  container.classList.add('container');
  document.body.appendChild(container);
  const title = document.createElement('h4');
  title.classList.add('title');
  title.textContent = 'Anchor menu';
  container.appendChild(title);

  itemType.relationships.fields.data
    .filter(f => f.id !== plugin.field.id)
    .forEach((relField) => {
      const link = document.createElement('a');
      const field = plugin.fields[relField.id];
      link.textContent = field.attributes.label;
      link.classList.add('link');
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (field.attributes.localized) {
          plugin.scrollToField(field.attributes.api_key, plugin.locale);
        } else {
          plugin.scrollToField(field.attributes.api_key);
        }
      });

      container.appendChild(link);
    });
});
