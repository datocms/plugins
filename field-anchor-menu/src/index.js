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
      const field = plugin.fields[relField.id];

      if (field.attributes.localized) {
        const allLocales = plugin.site.attributes.locales;
        const div = document.createElement('div');
        div.classList.add('localized-container');
        const firstSpan = document.createElement('span');
        firstSpan.textContent = `${field.attributes.label} [`;
        div.appendChild(firstSpan);
        allLocales.forEach((locale, index) => {
          const link = document.createElement('a');
          link.textContent = locale;
          link.classList.add('localized-link');
          link.addEventListener('click', (e) => {
            e.preventDefault();
            plugin.scrollToField(field.attributes.api_key, locale);
          });

          div.appendChild(link);
          if (allLocales.length > index + 1) {
            const devider = document.createElement('span');
            devider.textContent = ' | ';
            div.appendChild(devider);
          }
        });

        const secondSpan = document.createElement('span');
        secondSpan.textContent = ']';
        div.appendChild(secondSpan);
        container.appendChild(div);
      } else {
        const link = document.createElement('a');
        link.textContent = field.attributes.label;
        link.classList.add('link');
        link.addEventListener('click', (e) => {
          e.preventDefault();
          plugin.scrollToField(field.attributes.api_key);
        });

        container.appendChild(link);
      }
    });
});
