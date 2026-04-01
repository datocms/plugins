const SYNTHETIC_PAYLOAD_VERSION = '2026-02-25';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseUnknownPayload = (payload: unknown): unknown => {
  if (typeof payload !== 'string') {
    return payload;
  }

  return JSON.parse(payload);
};

const looksLikeEntityPayload = (
  value: unknown,
): value is Record<string, unknown> =>
  isRecord(value) &&
  typeof value.type === 'string' &&
  isRecord(value.relationships) &&
  isRecord(value.attributes);

const getNestedRecord = (
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined => {
  const candidate = value[key];
  return isRecord(candidate) ? candidate : undefined;
};

export type RecordBinCompatiblePayload = {
  event_type: 'to_be_restored';
  entity_type: 'item';
  environment: string;
  entity: Record<string, unknown>;
  event_triggered_at: string;
  related_entities: unknown[];
  __record_bin: {
    source: 'onBeforeItemsDestroy';
    version: string;
  };
};

export type NormalizedRecordBinPayload = {
  environment: string;
  entity: Record<string, unknown>;
  eventType?: string;
};

export type BuildRecordBinCompatiblePayloadInput = {
  environment: string;
  entity: Record<string, unknown>;
  capturedAt?: string;
};

export const buildRecordBinCompatiblePayload = ({
  environment,
  entity,
  capturedAt = new Date().toISOString(),
}: BuildRecordBinCompatiblePayloadInput): RecordBinCompatiblePayload => ({
  event_type: 'to_be_restored',
  entity_type: 'item',
  environment,
  entity,
  event_triggered_at: capturedAt,
  related_entities: [],
  __record_bin: {
    source: 'onBeforeItemsDestroy',
    version: SYNTHETIC_PAYLOAD_VERSION,
  },
});

export const normalizeRecordBinPayload = (
  payload: unknown,
  fallbackEnvironment: string,
): NormalizedRecordBinPayload => {
  const parsedPayload = parseUnknownPayload(payload);

  if (!isRecord(parsedPayload)) {
    throw new Error('Record body is not a JSON object.');
  }

  if (looksLikeEntityPayload(parsedPayload)) {
    return {
      environment: fallbackEnvironment,
      entity: parsedPayload,
    };
  }

  const entity = getNestedRecord(parsedPayload, 'entity');
  if (!entity) {
    throw new Error('Record body does not include an entity payload.');
  }

  const environment =
    typeof parsedPayload.environment === 'string' &&
    parsedPayload.environment.trim().length > 0
      ? parsedPayload.environment
      : fallbackEnvironment;

  const eventType =
    typeof parsedPayload.event_type === 'string'
      ? parsedPayload.event_type
      : undefined;

  return {
    environment,
    entity,
    eventType,
  };
};

export const extractEntityModelId = (
  entity: Record<string, unknown>,
): string | undefined => {
  const relationships = getNestedRecord(entity, 'relationships');
  if (!relationships) {
    return undefined;
  }

  const itemType = getNestedRecord(relationships, 'item_type');
  if (!itemType) {
    return undefined;
  }

  const data = getNestedRecord(itemType, 'data');
  if (!data) {
    return undefined;
  }

  return typeof data.id === 'string' ? data.id : undefined;
};

export const extractEntityAttributes = (
  entity: Record<string, unknown>,
): Record<string, unknown> => {
  const attributes = getNestedRecord(entity, 'attributes');
  return attributes ?? {};
};
