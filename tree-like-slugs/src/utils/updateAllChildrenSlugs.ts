import { buildClient, Client } from "@datocms/cma-client-browser";

/**
 * Recursively updates slugs for all descendant records in a tree hierarchy.
 * Each child's slug is updated to include the parent's slug as a prefix,
 * preserving only the child's own slug segment.
 *
 * @param client - CMA client instance (reused across recursive calls)
 * @param modelID - ID of the model containing the records
 * @param parentID - ID of the parent record whose children should be updated
 * @param slugFieldKey - API key of the slug field to update
 * @param updatedSlug - New slug value to use as prefix for children
 */
async function updateChildrenRecursively(
  client: Client,
  modelID: string,
  parentID: string,
  slugFieldKey: string,
  updatedSlug: string
) {
  // Fetch all direct children of the parent record
  const records = await client.items.list({
    filter: {
      type: modelID,
      fields: {
        parent: {
          eq: parentID,
        },
      },
    },
  });

  for (const record of records) {
    const existingSlug = record[slugFieldKey];

    // Skip records with missing or invalid slug values
    if (typeof existingSlug !== "string") {
      continue;
    }

    // Extract the child's own slug segment (last part after splitting by "/")
    const slugParts = existingSlug.split("/");
    const childOwnSlug = slugParts[slugParts.length - 1];
    const newChildSlug = updatedSlug + "/" + childOwnSlug;

    await client.items.update(record.id, {
      [slugFieldKey]: newChildSlug,
    });

    // Recursively update this child's descendants
    await updateChildrenRecursively(
      client,
      modelID,
      record.id,
      slugFieldKey,
      newChildSlug
    );
  }
}

/**
 * Entry point for updating all descendant slugs.
 * Creates the CMA client once and delegates to the recursive function.
 *
 * @param apiToken - Current user's access token for CMA API calls
 * @param environment - DatoCMS environment (e.g., "main")
 * @param modelID - ID of the model containing the records
 * @param parentID - ID of the parent record whose children should be updated
 * @param slugFieldKey - API key of the slug field to update
 * @param updatedSlug - New slug value to use as prefix for children
 */
export default async function updateAllChildrenSlugs(
  apiToken: string,
  environment: string,
  modelID: string,
  parentID: string,
  slugFieldKey: string,
  updatedSlug: string
) {
  const client = buildClient({
    apiToken,
    environment,
  });

  await updateChildrenRecursively(
    client,
    modelID,
    parentID,
    slugFieldKey,
    updatedSlug
  );
}
