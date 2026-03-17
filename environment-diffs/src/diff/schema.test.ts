import { describe, expect, it } from 'vitest';
import { compareSchemaSnapshots } from './schema';
import type { SchemaSnapshot } from '../types';

describe('compareSchemaSnapshots', () => {
  it('summarizes model, block, fieldset, and field changes by strict id match', () => {
    const left: SchemaSnapshot = {
      entities: [
        {
          rowId: 'model:model-1',
          id: 'model-1',
          entityType: 'model',
          label: 'Articles',
          apiKey: 'articles',
          payload: {
            name: 'Articles',
            api_key: 'articles',
          },
        },
        {
          rowId: 'block:block-1',
          id: 'block-1',
          entityType: 'block',
          label: 'Hero block',
          apiKey: 'hero_block',
          payload: {
            name: 'Hero block',
            api_key: 'hero_block',
          },
        },
        {
          rowId: 'fieldset:fieldset-1',
          id: 'fieldset-1',
          entityType: 'fieldset',
          label: 'SEO',
          parentId: 'model-1',
          parentLabel: 'Articles',
          payload: {
            title: 'SEO',
            position: 1,
          },
        },
        {
          rowId: 'field:field-1',
          id: 'field-1',
          entityType: 'field',
          label: 'Title',
          apiKey: 'title',
          parentId: 'model-1',
          parentLabel: 'Articles',
          payload: {
            label: 'Title',
            api_key: 'title',
            field_type: 'string',
          },
        },
      ],
    };

    const right: SchemaSnapshot = {
      entities: [
        {
          rowId: 'model:model-1',
          id: 'model-1',
          entityType: 'model',
          label: 'Articles updated',
          apiKey: 'articles',
          payload: {
            name: 'Articles updated',
            api_key: 'articles',
          },
        },
        {
          rowId: 'block:block-1',
          id: 'block-1',
          entityType: 'block',
          label: 'Hero block',
          apiKey: 'hero_block',
          payload: {
            name: 'Hero block',
            api_key: 'hero_block',
          },
        },
        {
          rowId: 'field:field-1',
          id: 'field-1',
          entityType: 'field',
          label: 'Title heading',
          apiKey: 'title',
          parentId: 'model-1',
          parentLabel: 'Articles updated',
          payload: {
            label: 'Title heading',
            api_key: 'title',
            field_type: 'string',
          },
        },
        {
          rowId: 'field:field-2',
          id: 'field-2',
          entityType: 'field',
          label: 'Summary',
          apiKey: 'summary',
          parentId: 'model-1',
          parentLabel: 'Articles updated',
          payload: {
            label: 'Summary',
            api_key: 'summary',
            field_type: 'text',
          },
        },
        {
          rowId: 'fieldset:fieldset-2',
          id: 'fieldset-2',
          entityType: 'fieldset',
          label: 'Content',
          parentId: 'model-1',
          parentLabel: 'Articles updated',
          payload: {
            title: 'Content',
            position: 2,
          },
        },
      ],
    };

    const result = compareSchemaSnapshots(left, right);

    expect(result.summary).toEqual({
      model: {
        total: 1,
        changed: 1,
        leftOnly: 0,
        rightOnly: 0,
        unchanged: 0,
      },
      block: {
        total: 1,
        changed: 0,
        leftOnly: 0,
        rightOnly: 0,
        unchanged: 1,
      },
      fieldset: {
        total: 2,
        changed: 0,
        leftOnly: 1,
        rightOnly: 1,
        unchanged: 0,
      },
      field: {
        total: 2,
        changed: 1,
        leftOnly: 0,
        rightOnly: 1,
        unchanged: 0,
      },
    });

    expect(result.rows.map((row) => [row.entityType, row.id, row.status])).toEqual([
      ['model', 'model:model-1', 'changed'],
      ['block', 'block:block-1', 'unchanged'],
      ['fieldset', 'fieldset:fieldset-2', 'rightOnly'],
      ['fieldset', 'fieldset:fieldset-1', 'leftOnly'],
      ['field', 'field:field-2', 'rightOnly'],
      ['field', 'field:field-1', 'changed'],
    ]);

    expect(result.details['model:model-1']).toMatchObject({
      entityType: 'model',
      status: 'changed',
      changes: [
        {
          path: 'name',
          kind: 'changed',
          leftValue: 'Articles',
          rightValue: 'Articles updated',
        },
      ],
    });

    expect(result.details['field:field-1']).toMatchObject({
      entityType: 'field',
      status: 'changed',
    });
  });
});
