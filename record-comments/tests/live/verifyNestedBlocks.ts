import { isItemWithOptionalMeta, type Client } from '@datocms/cma-client-browser';
import { verifySourceRecord, type QaFixtureOptions } from './fixtures';

type BlockDescriptor = { id: string; index: number; blockIndex: number };
type NestedBlockOptions = {
  blockModelId: string;
  prefix: string;
  recordIds: readonly string[];
  descriptors: readonly BlockDescriptor[];
  options: (index: number) => QaFixtureOptions;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNestedBlock(value: unknown) {
  if (isItemWithOptionalMeta(value)) {
    if (Object.keys(value.attributes).sort().join(',') !== 'heading,tag') throw new Error('Nested block fields differ from the two-field baseline schema.');
    return { id: value.id, modelId: value.relationships.item_type.data.id, heading: value.attributes.heading, tag: value.attributes.tag };
  }
  if (!isObject(value) || value.type !== 'item' || typeof value.id !== 'string' || !isObject(value.item_type) || typeof value.item_type.id !== 'string')
    throw new Error('Expected a fully expanded raw or normalized block.');
  const allowedKeys = ['id', 'type', 'meta', 'item_type', 'creator', '__itemTypeId', 'heading', 'tag'];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) throw new Error('Normalized block has unknown fields.');
  return { id: value.id, modelId: value.item_type.id, heading: value.heading, tag: value.tag };
}

/** Verify embedded blocks through their two owning records, using CMA nested mode. */
export async function verifyNestedEmbeddedBlocks(client: Client, fixture: NestedBlockOptions) {
  if (fixture.descriptors.length !== 3) throw new Error('Expected exactly three baseline embedded blocks.');
  const seen = new Set<string>();
  for (const index of [0, 1]) {
    const options = fixture.options(index);
    const source = await client.items.find(fixture.recordIds[index], { nested: true, version: 'current' });
    verifySourceRecord(options, source);
    if (source.item_type.id !== options.modelId || source.meta.status !== 'draft') throw new Error('Nested source model or publication state changed.');
    const body = source.body;
    if (!isObject(body)) throw new Error('Expected a fully expanded localized body.');
    if (Object.keys(body).length !== options.locales.length || Object.keys(body).some((locale) => !options.locales.includes(locale)))
      throw new Error('Nested body locale keys changed.');
    for (const locale of options.locales) {
      const blocks = body[locale];
      const expected = index === 0 && locale === 'pt' ? 2 : index === 1 && locale === 'en' ? 1 : 0;
      if (!Array.isArray(blocks) || blocks.length !== expected) throw new Error(`Nested source ${index}/${locale} block count changed.`);
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const block = readNestedBlock(blocks[blockIndex]);
        const descriptor = fixture.descriptors.find((candidate) => candidate.index === index && candidate.blockIndex === blockIndex);
        if (!descriptor || block.id !== descriptor.id || seen.has(block.id)) throw new Error('Nested baseline block ID or position changed.');
        if (block.modelId !== fixture.blockModelId || block.heading !== `${fixture.prefix} heading ${index}/${blockIndex}` || block.tag !== `${fixture.prefix} tag ${blockIndex}`)
          throw new Error(`Nested embedded block ${block.id} model or fields changed.`);
        seen.add(block.id);
      }
    }
  }
  if (seen.size !== fixture.descriptors.length) throw new Error('Nested embedded block total changed.');
  return { ownerReads: 2, verifiedBlockIds: [...seen] };
}
