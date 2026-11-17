/**
 * Creates the schema the live tests expect in the seed project's primary
 * environment. Safe to rerun: it only adds what is missing.
 * Usage, from the plugin folder: node e2e/setup/seed.ts
 */
import { buildClient } from '@datocms/cma-client-browser';
import { loadLiveEnv } from '../lib/liveEnv.ts';

const { cmaToken } = loadLiveEnv();
if (!cmaToken) throw new Error('E2E_CMA_TOKEN is missing from e2e/.env.local');
const client = buildClient({ apiToken: cmaToken });

const itemTypes = await client.itemTypes.list();
let article = itemTypes.find((itemType) => itemType.api_key === 'article');
if (!article) {
  article = await client.itemTypes.create({
    name: 'Article',
    api_key: 'article',
    draft_mode_active: true,
  });
  await client.fields.create(article.id, {
    label: 'Title',
    api_key: 'title',
    field_type: 'string',
    validators: { required: {} },
  });
  await client.fields.create(article.id, {
    label: 'Body',
    api_key: 'body',
    field_type: 'text',
  });
  await client.items.create({
    item_type: { type: 'item_type', id: article.id },
    title: 'Welcome',
    body: 'The one record every forked environment starts with.',
  });
}
console.log(`Seed ready: article model ${article.id}`);
