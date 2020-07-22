const disableField = plugin => {
  plugin.startAutoResizer()
  plugin.disableField(plugin.fieldPath, true)
}

export default disableField
