export function createCommentStorageFields() {
  return ['model_id', 'record_id', 'content'].map((api_key) => ({
    id: `field-${api_key}`,
    api_key,
    localized: false,
    field_type: api_key === 'content' ? 'json' : 'string',
    validators: api_key === 'record_id' ? { unique: {} } : {},
  }));
}
