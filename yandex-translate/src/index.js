import toQueryString from 'to-querystring';

import './style.sass';

window.DatoCmsPlugin.init((ext) => {
  const label = 'Translate in other languages';

  const link = document.createElement('a');

  const mainLocale = ext.site.attributes.locales[0];
  const currentLocale = ext.locale;
  const isLocalized = ext.field.attributes.localized;
  const { fieldPath } = ext;

  link.textContent = label;
  link.href = '#';
  link.classList.add('button');

  ext.startAutoResizer();

  if (currentLocale === mainLocale && isLocalized) {
    document.body.appendChild(link);
  }

  const translate = text => (
    Promise.all(
      ext.site.attributes.locales.slice(1).map((locale) => {
        const path = fieldPath.replace(
          new RegExp(`\\.${ext.locale}$`),
          `.${locale}`,
        );

        if (!text) {
          ext.setFieldValue(path, '');
          return Promise.resolve();
        }

        const qs = toQueryString({
          key: ext.parameters.global.yandexApiKey,
          lang: locale.substring(0, 2),
          text,
        });

        if (ext.parameters.global.developmentMode) {
          console.log(`Fetching '${locale}' translation for '${text}'`);
        }

        return fetch(`https://translate.yandex.net/api/v1.5/tr.json/translate?${qs}`)
          .then(res => res.json())
          .then(response => (
            ext.setFieldValue(path, response.text.join(' '))
          ));
      }),
    )
  );

  link.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentLocale === mainLocale && isLocalized) {
      link.textContent = 'Translating...';
      translate(ext.getFieldValue(fieldPath)).then(() => {
        link.textContent = label;
      });
    }
  });
});
