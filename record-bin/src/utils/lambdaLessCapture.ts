import { buildClient, type SchemaTypes } from "@datocms/cma-client-browser";
import type { OnBeforeItemsDestroyCtx } from "datocms-plugin-sdk";
import { createDebugLogger, isDebugEnabled } from "./debugLogger";
import { ensureRecordBinModel } from "./recordBinModel";
import {
  buildRecordBinCompatiblePayload,
  extractEntityAttributes,
  extractEntityModelId,
} from "./recordBinPayload";

const buildTrashLabel = (
  attributes: Record<string, unknown>,
  modelID: string
): string => {
  let titleValue = "No title record";
  for (const attributeKey of Object.keys(attributes)) {
    const attributeValue = attributes[attributeKey];
    if (
      typeof attributeValue === "string" &&
      Number.isNaN(Number(attributeValue))
    ) {
      titleValue = attributeValue;
      break;
    }
  }

  return `${titleValue} | Model: ${modelID} | ${new Date().toDateString()}`;
};

const getHookItemModelId = (item: SchemaTypes.Item): string | undefined => {
  const candidateModelId = item.relationships?.item_type?.data?.id;
  return typeof candidateModelId === "string" ? candidateModelId : undefined;
};

export type LambdaLessCaptureResult = {
  capturedCount: number;
  failedItemIds: string[];
  skippedRecordBinItems: number;
};

export const captureDeletedItemsWithoutLambda = async (
  items: SchemaTypes.Item[],
  ctx: OnBeforeItemsDestroyCtx
): Promise<LambdaLessCaptureResult> => {
  const debugLogger = createDebugLogger(
    isDebugEnabled(ctx.plugin.attributes.parameters),
    "lambdaLessCapture"
  );

  const result: LambdaLessCaptureResult = {
    capturedCount: 0,
    failedItemIds: [],
    skippedRecordBinItems: 0,
  };

  if (!ctx.currentUserAccessToken) {
    debugLogger.warn(
      "Skipping Lambda-less capture because currentUserAccessToken is missing"
    );
    await ctx.notice(
      "Record Bin could not archive deleted records because currentUserAccessToken is missing."
    );
    return {
      ...result,
      failedItemIds: items
        .map((item) => item.id)
        .filter((itemId): itemId is string => Boolean(itemId)),
    };
  }

  const client = buildClient({
    apiToken: ctx.currentUserAccessToken,
    environment: ctx.environment,
  });

  let recordBinModelId = "";
  try {
    const recordBinModel = await ensureRecordBinModel(client);
    recordBinModelId = recordBinModel.id;
  } catch (error) {
    debugLogger.error("Could not ensure record_bin model before delete capture", error);
    await ctx.notice(
      "Record Bin could not archive deleted records because the record_bin model is unavailable."
    );
    return {
      ...result,
      failedItemIds: items
        .map((item) => item.id)
        .filter((itemId): itemId is string => Boolean(itemId)),
    };
  }

  for (const item of items) {
    const itemId = item.id;
    if (!itemId) {
      continue;
    }

    if (getHookItemModelId(item) === recordBinModelId) {
      result.skippedRecordBinItems += 1;
      continue;
    }

    try {
      const fullItemResponse = await client.items.rawFind(itemId, { nested: true });
      const fullItemEntity = fullItemResponse.data as unknown as Record<
        string,
        unknown
      >;
      const deletedModelID =
        extractEntityModelId(fullItemEntity) ?? getHookItemModelId(item);
      if (!deletedModelID) {
        throw new Error("Deleted record model id could not be determined.");
      }

      if (deletedModelID === recordBinModelId) {
        result.skippedRecordBinItems += 1;
        continue;
      }

      const trashLabel = buildTrashLabel(
        extractEntityAttributes(fullItemEntity),
        deletedModelID
      );

      const payload = buildRecordBinCompatiblePayload({
        environment: ctx.environment,
        entity: fullItemEntity,
      });

      await client.items.create({
        item_type: {
          type: "item_type",
          id: recordBinModelId,
        },
        label: trashLabel,
        model: deletedModelID,
        record_body: JSON.stringify(payload),
        date_of_deletion: new Date().toISOString(),
      });

      result.capturedCount += 1;
    } catch (error) {
      result.failedItemIds.push(itemId);
      debugLogger.warn("Could not archive deleted record", {
        itemId,
        error,
      });
    }
  }

  if (result.failedItemIds.length > 0) {
    await ctx.notice(
      `Record Bin could not archive ${result.failedItemIds.length} deleted record(s). Deletion still completed.`
    );
  }

  debugLogger.log("Lambda-less delete capture finished", result);
  return result;
};
