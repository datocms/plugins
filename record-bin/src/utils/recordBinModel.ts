import { buildClient } from "@datocms/cma-client-browser";

type CmaClient = ReturnType<typeof buildClient>;

type RecordBinModel = {
  id: string;
};

const extractModelId = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" ? candidate.id : undefined;
};

const findExistingRecordBinModel = async (
  client: CmaClient
): Promise<RecordBinModel | undefined> => {
  try {
    const existingModel = await client.itemTypes.find("record_bin");
    const existingModelId = extractModelId(existingModel);
    if (!existingModelId) {
      return undefined;
    }

    return { id: existingModelId };
  } catch {
    return undefined;
  }
};

export const ensureRecordBinModel = async (
  client: CmaClient
): Promise<RecordBinModel> => {
  const existingModel = await findExistingRecordBinModel(client);
  if (existingModel) {
    return existingModel;
  }

  let createdModelId: string | undefined;

  try {
    const createdModel = await client.itemTypes.create({
      name: "🗑 Record Bin",
      api_key: "record_bin",
      collection_appearance: "table",
    });
    createdModelId = extractModelId(createdModel);
  } catch (error) {
    const modelCreatedInParallel = await findExistingRecordBinModel(client);
    if (modelCreatedInParallel) {
      return modelCreatedInParallel;
    }

    throw error;
  }

  if (!createdModelId) {
    throw new Error("Record Bin model creation returned an invalid model id.");
  }

  const labelField = await client.fields.create(createdModelId, {
    label: "Label",
    field_type: "string",
    api_key: "label",
    position: 1,
  });

  await client.fields.create(createdModelId, {
    label: "Model",
    field_type: "string",
    api_key: "model",
    position: 2,
  });

  await client.fields.create(createdModelId, {
    label: "Date of deletion",
    field_type: "date_time",
    api_key: "date_of_deletion",
    position: 3,
  });

  await client.fields.create(createdModelId, {
    label: "Record body",
    field_type: "json",
    api_key: "record_body",
    position: 4,
  });

  const labelFieldId = extractModelId(labelField);
  if (!labelFieldId) {
    throw new Error("Record Bin label field creation returned an invalid field id.");
  }

  await client.itemTypes.update(createdModelId, {
    title_field: {
      type: "field",
      id: labelFieldId,
    },
    collection_appearance: "table",
  });

  return {
    id: createdModelId,
  };
};
