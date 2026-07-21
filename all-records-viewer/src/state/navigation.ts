export function buildRecordEditorUrl(args: {
  environment: string;
  isEnvironmentPrimary: boolean;
  modelId: string;
  itemId: string;
}): string {
  const environmentPrefix = args.isEnvironmentPrimary
    ? ''
    : `/environments/${args.environment}`;

  return `${environmentPrefix}/editor/item_types/${args.modelId}/items/${args.itemId}`;
}
