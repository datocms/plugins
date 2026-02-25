import { buildClient } from "@datocms/cma-client-browser";

export type CleanupRecordBinWithoutLambdaInput = {
  currentUserAccessToken: string | undefined;
  environment: string;
  numberOfDays: number;
};

export type CleanupRecordBinWithoutLambdaResult = {
  deletedCount: number;
  skipped: boolean;
};

export const cleanupRecordBinWithoutLambda = async ({
  currentUserAccessToken,
  environment,
  numberOfDays,
}: CleanupRecordBinWithoutLambdaInput): Promise<CleanupRecordBinWithoutLambdaResult> => {
  if (!currentUserAccessToken) {
    throw new Error("Missing currentUserAccessToken for Lambda-less cleanup.");
  }

  const client = buildClient({
    apiToken: currentUserAccessToken,
    environment,
  });

  try {
    await client.itemTypes.find("record_bin");
  } catch {
    return {
      deletedCount: 0,
      skipped: true,
    };
  }

  const cutOffDate = new Date();
  cutOffDate.setDate(new Date().getDate() - numberOfDays);

  const recordsToDelete = await client.items.list({
    filter: {
      fields: {
        dateOfDeletion: {
          lte: cutOffDate.toISOString(),
        },
      },
      type: "record_bin",
    },
  });

  if (recordsToDelete.length === 0) {
    return {
      deletedCount: 0,
      skipped: false,
    };
  }

  await client.items.bulkDestroy({
    items: recordsToDelete.map((item) => ({
      type: "item",
      id: item.id,
    })),
  });

  return {
    deletedCount: recordsToDelete.length,
    skipped: false,
  };
};
