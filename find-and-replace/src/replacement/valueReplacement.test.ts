import type { ApiTypes } from '@datocms/cma-client-browser';
import { describe, expect, it } from 'vitest';
import { matchesForTraversedField } from '../selection/matcher';
import type { MatcherSpec, TraversedFieldValue } from '../selection/types';
import {
  compileReplacementTemplate,
  templateReplacer,
} from './replacementTemplate';
import { replaceExactMatches, replaceMatchingText } from './valueReplacement';

const matcher = (pattern: string, caseSensitive = true): MatcherSpec => ({
  kind: 'literal',
  pattern,
  caseSensitive,
  wholeWord: false,
});

const regex = (pattern: string, caseSensitive = true): MatcherSpec => ({
  kind: 'regex',
  pattern,
  caseSensitive,
  wholeWord: false,
});

function replacer(template: string, spec: MatcherSpec) {
  const compilation = compileReplacementTemplate(template, spec);
  if (!compilation.ok) throw new Error('Expected the template to compile');
  return templateReplacer(compilation.template);
}

function fieldValue(
  fieldType: ApiTypes.Field['field_type'],
  value: unknown,
): TraversedFieldValue {
  return {
    ref: {
      kind: 'field_value',
      siteId: 'site',
      environment: 'main',
      rootModelId: 'article',
      rootRecordId: 'article-1',
      rootRecordVersion: 'version-1',
      ownerModelId: 'article',
      ownerRecordId: 'article-1',
      fieldId: `field-${fieldType}`,
      fieldApiKey: 'content',
      fieldType,
      locale: null,
      blockAncestry: [],
      ancestorFieldValueIds: [],
      valuePath: ['attributes', 'content'],
      present: true,
      valueFingerprint: 'fingerprint',
    },
    value,
    field: {
      id: `field-${fieldType}`,
      label: 'Content',
      apiKey: 'content',
      fieldType,
      localized: false,
      position: 0,
      modelId: 'article',
      referencedBlockModelIds: [],
      exactMatchCompatible: true,
      raw: {} as ApiTypes.Field,
    },
    owner: { id: 'article-1', modelId: 'article' },
    isContainer: fieldType === 'structured_text',
  };
}

describe('replaceMatchingText', () => {
  it('replaces every non-overlapping scalar match with literal replacement text', () => {
    const result = replaceMatchingText(
      fieldValue('string', 'Sale SALE sale'),
      matcher('sale', false),
      '$1',
    );

    expect(result).toMatchObject({
      supported: true,
      changed: true,
      value: '$1 $1 $1',
      replacementCount: 3,
      preview: {
        beforeContext: '',
        beforeTruncated: false,
        matchedText: 'Sale',
        replacementText: '$1',
        afterContext: ' SALE sale',
        afterTruncated: false,
      },
    });
  });

  it('can remove matched text without treating an empty replacement as missing', () => {
    const result = replaceMatchingText(
      fieldValue('text', 'one—two—one'),
      matcher('one'),
      '',
    );

    expect(result.value).toBe('—two—');
    expect(result.replacementCount).toBe(2);
    expect(result.preview?.matchedText).toBe('one');
    expect(result.preview?.replacementText).toBe('');
  });

  it('keeps long field values out of the preview while retaining exact text and clipping metadata', () => {
    const result = replaceMatchingText(
      fieldValue('text', `${'x'.repeat(80)}SuMmEr SALE${'y'.repeat(80)}`),
      matcher('summer sale', false),
      'Autumn offer',
    );

    expect(result.preview).toEqual({
      beforeContext: 'x'.repeat(48),
      beforeTruncated: true,
      matchedText: 'SuMmEr SALE',
      replacementText: 'Autumn offer',
      afterContext: 'y'.repeat(48),
      afterTruncated: true,
    });
  });

  it('changes only SEO title and description text', () => {
    const seo = {
      title: 'Summer sale',
      description: 'The summer sale starts now',
      image: 'upload-1',
      twitter_card: 'summary_large_image',
      no_index: false,
    };
    const result = replaceMatchingText(
      fieldValue('seo', seo),
      matcher('summer sale', false),
      'Winter offer',
    );

    expect(result.value).toEqual({
      ...seo,
      title: 'Winter offer',
      description: 'The Winter offer starts now',
    });
    expect(result.replacementCount).toBe(2);
    expect(seo.title).toBe('Summer sale');
  });

  it('preserves Structured Text marks when a match crosses adjacent spans', () => {
    const structuredText = {
      schema: 'dast',
      document: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'span', value: 'Before ' },
              {
                type: 'span',
                marks: ['strong'],
                value: 'summer ',
              },
              {
                type: 'span',
                marks: ['emphasis'],
                value: 'sale',
              },
              { type: 'span', value: ' after' },
            ],
          },
        ],
      },
    };

    const result = replaceMatchingText(
      fieldValue('structured_text', structuredText),
      matcher('summer sale'),
      'winter offer',
    );

    expect(result.replacementCount).toBe(1);
    expect(result.value).toEqual({
      schema: 'dast',
      document: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'span', value: 'Before ' },
              {
                type: 'span',
                marks: ['strong'],
                value: 'winter offer',
              },
              {
                type: 'span',
                marks: ['emphasis'],
                value: '',
              },
              { type: 'span', value: ' after' },
            ],
          },
        ],
      },
    });
    expect(structuredText.document.children[0]?.children[1]?.value).toBe(
      'summer ',
    );
    expect(result.preview).toMatchObject({
      beforeContext: 'Before ',
      matchedText: 'summer sale',
      replacementText: 'winter offer',
      afterContext: ' after',
    });
  });

  it('replaces code flows without crossing paragraph boundaries', () => {
    const result = replaceMatchingText(
      fieldValue('structured_text', {
        schema: 'dast',
        document: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'span', value: 'summer' }],
            },
            {
              type: 'paragraph',
              children: [{ type: 'span', value: ' sale' }],
            },
            { type: 'code', code: 'summer sale' },
          ],
        },
      }),
      matcher('summer sale'),
      'winter offer',
    );

    expect(result.replacementCount).toBe(1);
    expect(result.value).toMatchObject({
      document: {
        children: [
          { children: [{ value: 'summer' }] },
          { children: [{ value: ' sale' }] },
          { type: 'code', code: 'winter offer' },
        ],
      },
    });
  });

  it("expands a regex template per match, with that match's captures", () => {
    const spec = regex('Acme (\\w+)');
    const result = replaceMatchingText(
      fieldValue('string', 'Acme Widget and Acme Gadget'),
      spec,
      replacer('$1 by Globex', spec),
    );

    expect(result.value).toBe('Widget by Globex and Gadget by Globex');
    expect(result.replacementCount).toBe(2);
    expect(result.preview?.replacementText).toBe('Widget by Globex');
  });

  it('puts a multi-span regex expansion in the first span and keeps the marks', () => {
    const structuredText = {
      schema: 'dast',
      document: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'span', value: 'Before ' },
              { type: 'span', marks: ['strong'], value: 'Acme ' },
              { type: 'span', marks: ['emphasis'], value: 'Widget' },
              { type: 'span', value: ' after, acme gadget' },
            ],
          },
        ],
      },
    };
    const spec = regex('Acme (?<product>\\w+)');
    const value = fieldValue('structured_text', structuredText);
    const matches = matchesForTraversedField(value, spec);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.fragments).toHaveLength(2);

    const result = replaceExactMatches(
      value,
      matches,
      replacer('$<product> (by $&)', spec),
    );

    expect(result.value).toEqual({
      schema: 'dast',
      document: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'span', value: 'Before ' },
              {
                type: 'span',
                marks: ['strong'],
                value: 'Widget (by Acme Widget)',
              },
              { type: 'span', marks: ['emphasis'], value: '' },
              { type: 'span', value: ' after, acme gadget' },
            ],
          },
        ],
      },
    });
    expect(result.preview).toMatchObject({
      matchedText: 'Acme Widget',
      replacementText: 'Widget (by Acme Widget)',
    });
  });

  it("uses each match's own expansion when a field has several", () => {
    const spec = regex('(\\d+)%');
    const value = fieldValue('text', '10% off, then 20% more');
    const matches = matchesForTraversedField(value, spec);

    const result = replaceExactMatches(
      value,
      [matches[1]].filter((match) => match !== undefined),
      replacer('$1 percent', spec),
    );

    expect(result.value).toBe('10% off, then 20 percent more');
    expect(result.replacementCount).toBe(1);
  });
});
