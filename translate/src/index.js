import debounce from 'debounce';
import toQueryString from 'to-querystring';

DatoCmsExtension.init((ext) => {
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = ext.placeholder;
  input.value = ext.getFieldValue(ext.fieldPath);

  ext.startAutoResizer();

  document.body.appendChild(input);

  ext.addFieldChangeListener(ext.fieldPath, (newValue) => {
    if (input.value !== newValue) {
      input.value = newValue;
    }
  });

  const translate = debounce((text) => {
    ext.site.attributes.locales.slice(1).forEach(locale => {
      const path = ext.fieldPath.replace(
        new RegExp(`\.${ext.locale}$`),
        `.${locale}`
      );

      if (!text) {
        ext.setFieldValue(path, '');
        return;
      }

      const qs = toQueryString({
        key: ext.parameters.global.yandexApiKey,
        lang: locale.substring(0, 2),
        text,
      });

      if (ext.parameters.global.developmentMode) {
        console.log(`Fetching "${locale}" translation for "${text}"`);
      }

      fetch(`https://translate.yandex.net/api/v1.5/tr.json/translate?${qs}`)
        .then(res => res.json())
        .then(({ text }) => (
          ext.setFieldValue(path, text.join(' '))
        ));
    });
  }, 500);

  const change = (e) => {
    const mainLocale = ext.site.attributes.locales[0];
    const locale = ext.locale;
    const isLocalized = ext.field.attributes.localized;
    const path = ext.fieldPath;
    const value = e.target.value;

    ext.setFieldValue(path, value);

    if (locale === mainLocale && isLocalized) {
      translate(value);
    }
  }

  input.addEventListener("change", change);
  input.addEventListener("keyup", change);
});
