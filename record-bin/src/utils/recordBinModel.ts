import type { buildClient } from '@datocms/cma-client-browser';

type CmaClient = ReturnType<typeof buildClient>;
type BinModel = Awaited<ReturnType<CmaClient['itemTypes']['find']>>;
type BinField = Awaited<ReturnType<CmaClient['fields']['list']>>[number];

type RecordBinModel = {
  id: string;
};

const REQUIRED_FIELDS = [
  { label: 'Label', field_type: 'string', api_key: 'label', position: 1 },
  { label: 'Model', field_type: 'string', api_key: 'model', position: 2 },
  {
    label: 'Date of deletion',
    field_type: 'date_time',
    api_key: 'date_of_deletion',
    position: 3,
  },
  {
    label: 'Record body',
    field_type: 'json',
    api_key: 'record_body',
    position: 4,
  },
] as const;

const isNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object' || !('response' in error)) {
    return false;
  }

  const response = error.response;
  return (
    response !== null &&
    typeof response === 'object' &&
    'status' in response &&
    response.status === 404
  );
};

const assertCompatibleModel = (model: BinModel): void => {
  if (!model || typeof model.id !== 'string' || model.id.length === 0) {
    throw new Error('Record Bin model returned an invalid model id.');
  }

  if (model.singleton || model.modular_block) {
    throw new Error('The record_bin model must be a regular collection model.');
  }
};

const findExistingRecordBinModel = async (
  client: CmaClient,
): Promise<BinModel | undefined> => {
  let existingModel: BinModel;
  try {
    existingModel = await client.itemTypes.find('record_bin');
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }

  assertCompatibleModel(existingModel);
  return existingModel;
};

const findCompatibleField = (
  fields: BinField[],
  definition: (typeof REQUIRED_FIELDS)[number],
): BinField | undefined => {
  const matchingFields = fields.filter(
    (field) => field.api_key === definition.api_key,
  );

  if (matchingFields.length > 1) {
    throw new Error(`Record Bin has duplicate ${definition.api_key} fields.`);
  }

  const field = matchingFields[0];
  if (!field) {
    return undefined;
  }

  if (
    typeof field.id !== 'string' ||
    !field.id ||
    field.field_type !== definition.field_type ||
    field.localized
  ) {
    throw new Error(
      `Record Bin field ${definition.api_key} must be a non-localized ${definition.field_type} field.`,
    );
  }

  return field;
};

const ensureField = async (
  client: CmaClient,
  modelId: string,
  fields: BinField[],
  definition: (typeof REQUIRED_FIELDS)[number],
): Promise<BinField[]> => {
  if (findCompatibleField(fields, definition)) {
    return fields;
  }

  const createdField = await client.fields.create(modelId, definition);
  if (!findCompatibleField([createdField], definition)) {
    throw new Error(
      `Record Bin creation returned an invalid ${definition.api_key} field.`,
    );
  }
  return [...fields, createdField];
};

const ensureRequiredFields = async (
  client: CmaClient,
  modelId: string,
): Promise<BinField[]> => {
  let fields = await client.fields.list(modelId);
  if (!Array.isArray(fields)) {
    throw new Error('Record Bin fields could not be read.');
  }

  // Validate existing schema before making any repair, preserving user fields.
  for (const definition of REQUIRED_FIELDS) {
    findCompatibleField(fields, definition);
  }

  for (const definition of REQUIRED_FIELDS) {
    fields = await ensureField(client, modelId, fields, definition);
  }

  // Concurrent repair must not introduce an incompatible remaining field.
  for (const definition of REQUIRED_FIELDS) {
    if (!findCompatibleField(fields, definition)) {
      throw new Error(`Record Bin field ${definition.api_key} is missing.`);
    }
  }

  return fields;
};

export const ensureRecordBinModel = async (
  client: CmaClient,
): Promise<RecordBinModel> => {
  let model = await findExistingRecordBinModel(client);

  if (!model) {
    try {
      model = await client.itemTypes.create({
        name: '🗑 Record Bin',
        api_key: 'record_bin',
        collection_appearance: 'table',
      });
      assertCompatibleModel(model);
    } catch (error) {
      // Another deletion may have created the model in parallel.
      model = await findExistingRecordBinModel(client);
      if (!model) {
        throw error;
      }
    }
  }

  const fields = await ensureRequiredFields(client, model.id);
  const labelField = findCompatibleField(fields, REQUIRED_FIELDS[0]);
  if (!labelField) {
    throw new Error('Record Bin label field is missing.');
  }

  if (!model.title_field) {
    const modelId = model.id;
    await client.itemTypes.update(modelId, {
      title_field: { type: 'field', id: labelField.id },
    });
  }

  return { id: model.id };
};
