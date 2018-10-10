window.DatoCmsPlugin.init((plugin) => {
  const slaveFields = plugin.parameters.instance.slaveFields.split(/\s*,\s*/);

  function toggleFields(value) {
    slaveFields.forEach((slaveField) => {
      plugin.toggleField(slaveField, value);
    });
  }

  toggleFields(!!plugin.getFieldValue(plugin.fieldPath));

  plugin.addFieldChangeListener(plugin.fieldPath, (value) => {
    toggleFields(!!value);
  });
});
