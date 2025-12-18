import { Client } from "@datocms/cma-client-browser";

export default async function updateSlugRedirects(
  urlPrefix: string,
  oldSlug: string,
  newSlug: string,
  recordID: string,
  client: Client
) {
  if (oldSlug === newSlug) {
    return;
  }

  const newObject = {
    source: oldSlug,
    destination: newSlug,
    urlPrefix,
    recordID: recordID,
  };

  const records = await client.items.list({
    filter: {
      type: "slug_redirect",
    },
  });

  const oldFieldValue = await JSON.parse(records[0].redirects as string);

  oldFieldValue.push(newObject);

  client.items.update(records[0].id as string, {
    redirects: JSON.stringify(oldFieldValue, null, 2),
  });
}
