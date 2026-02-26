import { buildClient } from "@datocms/cma-client-browser";
import { errorObject } from "../types/types";
import { normalizeRecordBinPayload } from "./recordBinPayload";
import { buildRestoreErrorPayload } from "./restoreError";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const recursivelyDeleteAllBlockIDs = (
  recursiveObject: unknown,
  previousKey: string
) => {
  if (Array.isArray(recursiveObject)) {
    for (const arrayItem of recursiveObject) {
      recursivelyDeleteAllBlockIDs(arrayItem, previousKey);
    }
    return;
  }

  if (!isRecord(recursiveObject)) {
    return;
  }

  if (
    Object.prototype.hasOwnProperty.call(recursiveObject, "id") &&
    previousKey !== "data"
  ) {
    delete recursiveObject.id;
  }

  for (const key of Object.keys(recursiveObject)) {
    const child = recursiveObject[key];
    if (typeof child === "object" && child !== null) {
      recursivelyDeleteAllBlockIDs(child, key);
    }
  }
};

const deepCloneRecord = (
  value: Record<string, unknown>
): Record<string, unknown> => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

const sanitizeEntityForCreation = (
  entity: Record<string, unknown>
): Record<string, unknown> => {
  const requestBody = deepCloneRecord(entity);
  delete requestBody.id;

  const attributes = isRecord(requestBody.attributes)
    ? requestBody.attributes
    : {};
  delete attributes.created_at;
  delete attributes.updated_at;
  requestBody.attributes = attributes;

  const relationships = isRecord(requestBody.relationships)
    ? requestBody.relationships
    : {};
  delete relationships.creator;
  requestBody.relationships = relationships;

  const meta = isRecord(requestBody.meta) ? requestBody.meta : {};
  requestBody.meta = {
    created_at: meta.created_at,
    first_published_at: meta.first_published_at,
  };

  recursivelyDeleteAllBlockIDs(requestBody, "");
  return requestBody;
};

export class LambdaLessRestoreError extends Error {
  readonly restorationError: errorObject;

  constructor(message: string, restorationError: errorObject) {
    super(message);
    this.name = "LambdaLessRestoreError";
    this.restorationError = restorationError;
  }
}

export const isLambdaLessRestoreError = (
  error: unknown
): error is LambdaLessRestoreError => error instanceof LambdaLessRestoreError;

export type RestoreRecordWithoutLambdaInput = {
  currentUserAccessToken: string | undefined;
  currentEnvironment: string;
  recordBody: unknown;
  trashRecordID: string;
};

export type RestoreRecordWithoutLambdaResult = {
  restoredRecord: {
    id: string;
    modelID: string;
  };
};

export const restoreRecordWithoutLambda = async ({
  currentUserAccessToken,
  currentEnvironment,
  recordBody,
  trashRecordID,
}: RestoreRecordWithoutLambdaInput): Promise<RestoreRecordWithoutLambdaResult> => {
  if (!currentUserAccessToken) {
    throw new Error("Missing currentUserAccessToken for Lambda-less restore.");
  }

  const normalizedPayload = normalizeRecordBinPayload(
    recordBody,
    currentEnvironment
  );
  const requestBody = sanitizeEntityForCreation(normalizedPayload.entity);

  const client = buildClient({
    apiToken: currentUserAccessToken,
    environment: currentEnvironment,
  });

  let restoredRecordResponse:
    | {
        data: {
          id: string;
          relationships: {
            item_type: {
              data: {
                id: string;
              };
            };
          };
        };
      }
    | undefined;

  try {
    restoredRecordResponse = await client.items.rawCreate({
      data: requestBody as never,
    });
  } catch (error) {
    throw new LambdaLessRestoreError(
      "The record could not be restored!",
      buildRestoreErrorPayload(error)
    );
  }

  await client.items.destroy(trashRecordID);

  const restoredRecordId = restoredRecordResponse.data.id;
  const restoredModelId =
    restoredRecordResponse.data.relationships.item_type.data.id;

  return {
    restoredRecord: {
      id: restoredRecordId,
      modelID: restoredModelId,
    },
  };
};
