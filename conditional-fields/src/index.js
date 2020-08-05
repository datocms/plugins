import values from 'object.values';

window.DatoCmsPlugin.init((plugin) => {
  const targetFields = plugin.parameters.instance.targetFields.split(/\s*,\s*/);
  const { invert } = plugin.parameters.instance;
  const sourceField = plugin.field;

  function toggleFields(value) {
    targetFields.forEach((targetFieldApiKey) => {
      const targetField = values(plugin.fields).find(
        field => field.attributes.api_key === targetFieldApiKey,
      );

      if (targetField) {
        const targetPath = plugin.parentFieldId
          ? `${plugin.fieldPath.replace(/.[^.]*$/, '')}.${targetFieldApiKey}`
          : targetFieldApiKey;

        if (sourceField.attributes.localized) {
          if (targetField.attributes.localized) {
            plugin.toggleField(`${targetPath}.${plugin.locale}`, value);
          }
        } else if (targetField.attributes.localized) {
          plugin.site.attributes.locales.forEach((locale) => {
            plugin.toggleField(`${targetPath}.${locale}`, value);
          });
        } else {
          plugin.toggleField(targetPath, value);
        }
      } else {
        console.error(`Plugin error: The field "${targetFieldApiKey}" does not exist`);
      }
    });
  }

  toggleFields(!!plugin.getFieldValue(plugin.fieldPath));

  plugin.addFieldChangeListener(plugin.fieldPath, (value) => {
    const show = invert ? !value : !!value;
    toggleFields(show);
  });
});
