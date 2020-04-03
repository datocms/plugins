import values from 'object.values';

window.DatoCmsPlugin.init((plugin) => {
  const slaveFields = plugin.parameters.instance.slaveFields.split(/\s*,\s*/);
  const { invert } = plugin.parameters.instance;
  const masterField = plugin.field;

  function toggleFields(value) {
    slaveFields.forEach((slaveFieldApiKey) => {
      const slaveField = values(plugin.fields).find(
        field => field.attributes.api_key === slaveFieldApiKey,
      );

      if (slaveField) {
        const slavePath = plugin.parentFieldId
          ? `${plugin.fieldPath.replace(/.[^.]*$/, '')}.${slaveFieldApiKey}`
          : slaveFieldApiKey;

        if (masterField.attributes.localized) {
          if (slaveField.attributes.localized) {
            plugin.toggleField(`${slavePath}.${plugin.locale}`, value);
          }
        } else if (slaveField.attributes.localized) {
          plugin.site.attributes.locales.forEach((locale) => {
            plugin.toggleField(`${slavePath}.${locale}`, value);
          });
        } else {
          plugin.toggleField(slavePath, value);
        }
      } else {
        console.error(`Plugin error: The field "${slaveFieldApiKey}" does not exist`);
      }
    });
  }

  toggleFields(!!plugin.getFieldValue(plugin.fieldPath));

  plugin.addFieldChangeListener(plugin.fieldPath, (value) => {
    const show = invert ? !value : !!value;
    toggleFields(show);
  });
});
