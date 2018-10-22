import toQueryString from 'to-querystring';

import './style.sass';

window.DatoCmsPlugin.init((plugin) => {
  const label = 'Translate in other languages';

  const link = document.createElement('a');

  const mainLocale = plugin.site.attributes.locales[0];
  const currentLocale = plugin.locale;
  const isLocalized = plugin.field.attributes.localized;
  const { fieldPath } = plugin;

  link.textContent = label;
  link.href = '#';
  link.classList.add('button');

  plugin.startAutoResizer();

  if (currentLocale === mainLocale && isLocalized) {
    document.body.appendChild(link);
  }

  const translate = (text, format) => (
    Promise.all(
      plugin.site.attributes.locales.slice(1).map((locale) => {
        const path = fieldPath.replace(
          new RegExp(`\\.${plugin.locale}$`),
          `.${locale}`,
        );

        if (!text) {
          plugin.setFieldValue(path, '');
          return Promise.resolve();
        }

        const qs = toQueryString({
          key: plugin.parameters.global.yandexApiKey,
          lang: locale.substring(0, 2),
          format,
          text,
        });

        if (plugin.parameters.global.developmentMode) {
          console.log(`Fetching '${locale}' translation for '${text}'`);
        }

        return fetch(`https://translate.yandex.net/api/v1.5/tr.json/translate?${qs}`)
          .then(res => res.json())
          .then(response => (
            plugin.setFieldValue(path, response.text.join(' '))
          ));
      }),
    )
  );

  link.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentLocale === mainLocale && isLocalized) {
      link.textContent = 'Translating...';

      const { attributes: field } = plugin.field;

      const format = field.appeareance.editor === 'wysiwyg' ? 'html' : 'plain';

      translate(plugin.getFieldValue(fieldPath), format).then(() => {
        link.textContent = label;
      });
    }
  });
});
