import { describe, expect, it } from 'vitest';
import {
  cloneRoot,
  findReplaceRoot,
  findReplaceSchema,
} from '../replacement/replacementPlanner.fixtures';
import { fieldPathSegments, seoSubfieldLabel } from './labels';
import { traverseRecord } from './traversal';
import type { SchemaIndex, TraversedFieldValue } from './types';

type Root = ReturnType<typeof findReplaceRoot>;

function fieldValues(record: Root, schema = findReplaceSchema()) {
  return traverseRecord({
    record,
    rootModelId: 'article-model',
    schema,
    siteId: 'site-1',
    environment: 'main',
    locales: ['en', 'it'],
  });
}

function pathOf(
  record: Root,
  predicate: (fieldValue: TraversedFieldValue) => boolean,
  fragments?: Parameters<typeof fieldPathSegments>[0]['fragments'],
  schema: SchemaIndex = findReplaceSchema(),
): string[] {
  const fieldValue = fieldValues(record, schema).find(predicate);
  expect(fieldValue).toBeDefined();
  if (!fieldValue) return [];
  return fieldPathSegments({
    fieldValue: fieldValue.ref,
    schema,
    record,
    fragments,
  });
}

const owner = (ownerRecordId: string, fieldApiKey: string) => {
  return (fieldValue: TraversedFieldValue): boolean =>
    fieldValue.ref.ownerRecordId === ownerRecordId &&
    fieldValue.ref.fieldApiKey === fieldApiKey;
};

function withoutSecondQuote(): Root {
  const record = cloneRoot(findReplaceRoot());
  const attributes = record.attributes as Record<string, unknown>;
  const content = attributes.content as Array<{ id: string }>;
  attributes.content = content.filter((block) => block.id !== 'q-2');
  return record;
}

describe('fieldPathSegments', () => {
  it('uses the field label for root fields', () => {
    const record = findReplaceRoot();
    expect(pathOf(record, owner('article-1', 'title'))).toEqual(['Title']);
    expect(pathOf(record, owner('article-1', 'headline'))).toEqual([
      'Headline',
    ]);
  });

  it('numbers repeated blocks of the same model among their siblings only', () => {
    const record = findReplaceRoot();
    expect(pathOf(record, owner('q-1', 'text'))).toEqual([
      'Content',
      'Quote 1',
      'Text',
    ]);
    expect(pathOf(record, owner('q-2', 'text'))).toEqual([
      'Content',
      'Quote 2',
      'Text',
    ]);
    expect(pathOf(record, owner('c-1', 'label'))).toEqual([
      'Content',
      'Callout',
      'Label',
    ]);
  });

  it('drops the ordinal when only one block of that model remains', () => {
    const record = withoutSecondQuote();
    expect(pathOf(record, owner('q-1', 'text'))).toEqual([
      'Content',
      'Quote',
      'Text',
    ]);
  });

  it('never numbers a single block', () => {
    expect(pathOf(findReplaceRoot(), owner('q-hero', 'text'))).toEqual([
      'Hero',
      'Quote',
      'Text',
    ]);
  });

  it('labels Structured Text blocks and inline blocks', () => {
    const record = findReplaceRoot();
    expect(pathOf(record, owner('q-body', 'text'))).toEqual([
      'Body',
      'Quote',
      'Text',
    ]);
    expect(pathOf(record, owner('cta-1', 'label'))).toEqual([
      'Body',
      'Call to action',
      'Label',
    ]);
  });

  it('counts Structured Text blocks in document order, not every root node', () => {
    const record = cloneRoot(findReplaceRoot());
    const attributes = record.attributes as Record<string, unknown>;
    const body = attributes.body as {
      en: { document: { children: unknown[] } };
    };
    body.en.document.children.push({
      type: 'block',
      item: {
        id: 'q-body-2',
        type: 'item',
        attributes: { text: 'Another Acme quote' },
        relationships: {
          item_type: { data: { id: 'quote-block', type: 'item_type' } },
        },
        meta: {},
      },
    });

    expect(pathOf(record, owner('q-body', 'text'))).toEqual([
      'Body',
      'Quote 1',
      'Text',
    ]);
    expect(pathOf(record, owner('q-body-2', 'text'))).toEqual([
      'Body',
      'Quote 2',
      'Text',
    ]);
  });

  it('follows blocks nested two levels deep', () => {
    expect(pathOf(findReplaceRoot(), owner('q-3', 'text'))).toEqual([
      'Content',
      'Section',
      'Items',
      'Quote',
      'Text',
    ]);
  });

  it('adds the SEO subfield from the match fragments', () => {
    const record = findReplaceRoot();
    expect(
      pathOf(record, owner('article-1', 'seo'), [
        { path: ['description'], start: 4, end: 8 },
      ]),
    ).toEqual(['SEO', 'Description']);
    expect(
      pathOf(record, owner('article-1', 'seo'), [
        { path: ['title'], start: 0, end: 4 },
      ]),
    ).toEqual(['SEO', 'Title']);
    expect(pathOf(record, owner('article-1', 'seo'))).toEqual(['SEO']);
    expect(seoSubfieldLabel([{ path: [], start: 0, end: 1 }])).toBeNull();
  });

  it('falls back to the API key only when a label is empty', () => {
    const schema = findReplaceSchema();
    const quoteText = schema.fieldsById.get('quote-text-field');
    expect(quoteText).toBeDefined();
    if (!quoteText) return;
    const fieldsById = new Map(schema.fieldsById);
    fieldsById.set(quoteText.id, { ...quoteText, label: '' });

    expect(
      pathOf(findReplaceRoot(), owner('q-hero', 'text'), undefined, {
        ...schema,
        fieldsById,
      }),
    ).toEqual(['Hero', 'Quote', 'text']);
  });
});
