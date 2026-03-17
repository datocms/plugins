import { describe, expect, it } from 'vitest';
import { compareContentSnapshots } from './content';
import type { ContentSnapshot } from '../types';

describe('compareContentSnapshots', () => {
  it('groups content rows by model and reports publication changes separately', () => {
    const left: ContentSnapshot = {
      models: [
        {
          id: 'article',
          name: 'Article',
          apiKey: 'article',
          titleFieldApiKey: 'title',
          fields: [
            {
              id: 'article-title',
              apiKey: 'title',
              label: 'Title',
              fieldType: 'string',
            },
            {
              id: 'article-body',
              apiKey: 'body',
              label: 'Body',
              fieldType: 'text',
            },
          ],
        },
        {
          id: 'page',
          name: 'Page',
          apiKey: 'page',
          titleFieldApiKey: 'headline',
          fields: [
            {
              id: 'page-headline',
              apiKey: 'headline',
              label: 'Headline',
              fieldType: 'string',
            },
          ],
        },
      ],
      records: [
        {
          rowId: 'record:article-1',
          id: 'article-1',
          modelId: 'article',
          modelName: 'Article',
          modelApiKey: 'article',
          label: 'Alpha',
          publicationStatus: 'published',
          systemValues: {},
          fieldValues: {
            title: 'Alpha',
            body: 'Left body',
          },
        },
        {
          rowId: 'record:page-1',
          id: 'page-1',
          modelId: 'page',
          modelName: 'Page',
          modelApiKey: 'page',
          label: 'Landing',
          publicationStatus: 'draft',
          systemValues: {},
          fieldValues: {
            headline: 'Landing',
          },
        },
      ],
    };

    const right: ContentSnapshot = {
      models: left.models,
      records: [
        {
          rowId: 'record:article-1',
          id: 'article-1',
          modelId: 'article',
          modelName: 'Article',
          modelApiKey: 'article',
          label: 'Alpha',
          publicationStatus: 'draft',
          systemValues: {},
          fieldValues: {
            title: 'Alpha',
            body: 'Right body',
          },
        },
        {
          rowId: 'record:article-2',
          id: 'article-2',
          modelId: 'article',
          modelName: 'Article',
          modelApiKey: 'article',
          label: 'Beta',
          publicationStatus: 'published',
          systemValues: {},
          fieldValues: {
            title: 'Beta',
            body: 'New body',
          },
        },
      ],
    };

    const result = compareContentSnapshots(left, right);

    expect(result.summaryRows).toEqual([
      {
        id: 'article',
        label: 'Article',
        description: 'article',
        apiKey: 'article',
        counts: {
          total: 2,
          changed: 1,
          leftOnly: 0,
          rightOnly: 1,
          unchanged: 0,
        },
      },
      {
        id: 'page',
        label: 'Page',
        description: 'page',
        apiKey: 'page',
        counts: {
          total: 1,
          changed: 0,
          leftOnly: 1,
          rightOnly: 0,
          unchanged: 0,
        },
      },
    ]);

    expect(result.rows.map((row) => [row.id, row.status, row.publicationState])).toEqual([
      ['record:article-1', 'changed', 'published → draft'],
      ['record:article-2', 'rightOnly', 'missing → published'],
      ['record:page-1', 'leftOnly', 'draft → missing'],
    ]);

    expect(result.details['record:article-1']).toMatchObject({
      modelId: 'article',
      modelName: 'Article',
      status: 'changed',
      changes: [
        {
          path: 'fieldValues.body',
          kind: 'changed',
          leftValue: 'Left body',
          rightValue: 'Right body',
        },
        {
          path: 'publicationStatus',
          kind: 'changed',
          leftValue: 'published',
          rightValue: 'draft',
        },
      ],
    });
  });
});
