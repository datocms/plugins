import { buildClient } from "@datocms/cma-client-browser";

export default async function updateAllChildrenSlugs(
  apiToken: string,
  modelID: string,
  parentID: string,
  slugFieldKey: string,
  updatedSlug: string
) {
  const client = buildClient({
    apiToken,
  });

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

  if (records.length) {
    for (const record of records) {
      const destructuredOldSlug = (record[slugFieldKey] as string).split("/");
      await client.items.update(record.id, {
        [slugFieldKey]:
          updatedSlug +
          "/" +
          destructuredOldSlug[destructuredOldSlug.length - 1],
      });

      await updateAllChildrenSlugs(
        apiToken,
        modelID,
        record.id,
        slugFieldKey,
        updatedSlug + "/" + destructuredOldSlug[destructuredOldSlug.length - 1]
      );
    }
  }
}
