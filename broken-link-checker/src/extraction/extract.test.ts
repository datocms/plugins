import { describe, expect, it, vi } from 'vitest';
import type {
  ContentField,
  ContentModel,
  ContentSchema,
  RecordInput,
} from '../types';
import { extractLinks } from './extract';

function field(
  apiKey: string,
  type = 'string',
  editor = 'single_line',
  localized = false,
): ContentField {
  return {
    id: apiKey,
    apiKey,
    label: apiKey,
    type,
    editor: editor === 'single_block' ? 'framed_single_block' : editor,
    localized,
  };
}

function model(
  id: string,
  fields: ContentField[],
  isBlock = false,
): ContentModel {
  return { id, name: id, isBlock, fields };
}

function schema(...models: ContentModel[]): ContentSchema {
  return new Map(models.map((entry) => [entry.id, entry]));
}

function record(values: Record<string, unknown>): RecordInput {
  return { id: 'record-1', modelId: 'page', title: 'Example page', values };
}

function block(
  modelId: string,
  attributes: Record<string, unknown>,
  id?: string,
) {
  return {
    ...(id ? { id } : {}),
    type: 'item',
    attributes,
    relationships: { item_type: { data: { type: 'item_type', id: modelId } } },
  };
}

function dast(children: unknown[]) {
  return { schema: 'dast', document: { type: 'root', children } };
}

function urls(result: ReturnType<typeof extractLinks>) {
  return result.occurrences.map((occurrence) => occurrence.url);
}

describe('schema-aware link extraction', () => {
  it('reads owned nested blocks through all five supported levels while keeping occurrence paths', () => {
    let nested: ReturnType<typeof block> = block('cta', {
      url: 'https://nested.example',
    });
    for (let level = 1; level < 5; level += 1)
      nested = block('cta', { next: nested });
    const result = extractLinks(
      record({ section: nested }),
      schema(
        model('page', [field('section', 'single_block', 'single_block')]),
        model(
          'cta',
          [field('url'), field('next', 'single_block', 'single_block')],
          true,
        ),
      ),
      [],
    );
    expect(urls(result)).toEqual(['https://nested.example']);
    expect(
      result.occurrences[0].blockPath.filter((part) => part === 'cta'),
    ).toHaveLength(5);
    expect(result.warnings).toEqual([]);
  });
  it('keeps URL-looking string destinations for classification without turning titles into URLs', () => {
    const fields = [
      'url',
      'relative',
      'fragment',
      'protocolRelative',
      'email',
      'phone',
      'malformed',
      'domain',
      'title',
      'subtitle',
      'custom',
    ].map((key) => field(key));
    fields[10].editor = 'custom-editor-id';
    const result = extractLinks(
      record({
        url: ' https://example.com/path ',
        relative: '/about',
        fragment: '#section',
        protocolRelative: '//example.com/path',
        email: 'mailto:hello@example.com',
        phone: 'tel:+123456',
        malformed: 'https://bad host',
        domain: 'example.com',
        title: 'An ordinary page title',
        subtitle: 'Note: remember to read this',
        custom: 'https://custom-editor.example',
      }),
      schema(model('page', fields)),
      ['en'],
    );

    expect(urls(result)).toEqual([
      'https://example.com/path',
      '/about',
      '#section',
      '//example.com/path',
      'mailto:hello@example.com',
      'tel:+123456',
      'https://bad host',
      'example.com',
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('finds prose URLs without inventing schemes or consuming trailing punctuation', () => {
    const result = extractLinks(
      record({
        body: 'Visit https://example.com/one, then https://example.com/two. Or visit example.org.',
      }),
      schema(model('page', [field('body', 'text', 'textarea')])),
      [],
    );
    expect(urls(result)).toEqual([
      'https://example.com/one',
      'https://example.com/two',
    ]);
  });

  it('parses Markdown references, entities, autolinks and embedded HTML while excluding code and images', () => {
    const value = [
      '[First][target] and [Second][TARGET].',
      '',
      '[target]: https://example.com/?a=1&b=2',
      '[unused]: https://unused.example',
      '',
      '[Entity](https://example.com/?a=1&amp;b=2)',
      '[Relative](/about) and [Empty]() and <https://autolink.example>.',
      'Bare https://bare.example and www.protocol-missing.example',
      '`https://inline-code.example`',
      '```html',
      '<a href="https://fenced-code.example">code</a>',
      '```',
      '<a href="https://html.example/?a=1&amp;b=2">HTML</a>',
      '<code>https://html-code.example</code>',
      '<pre><a href="https://pre-code.example">code</a></pre>',
      '![image](https://image.example/file.png)',
    ].join('\n');
    const result = extractLinks(
      record({ body: value }),
      schema(model('page', [field('body', 'text', 'markdown')])),
      [],
    );
    expect(urls(result)).toEqual([
      'https://example.com/?a=1&b=2',
      'https://example.com/?a=1&b=2',
      'https://example.com/?a=1&b=2',
      '/about',
      '',
      'https://autolink.example',
      'https://bare.example',
      'www.protocol-missing.example',
      'https://html.example/?a=1&b=2',
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('extracts HTML anchor destinations without resolving relatives or reading code/assets', () => {
    const result = extractLinks(
      record({
        body: `
      <a href="/relative?a=1&amp;b=2">Relative</a>
      <a href="https://example.com">External</a>
      <code><a href="https://code.example">Code</a></code>
      <pre><a href="https://pre.example">Pre</a></pre>
      <template><a href="https://template.example">Template</a></template>
      <img src="https://image.example/image.png">
      https://plain-text.example
    `,
      }),
      schema(model('page', [field('body', 'text', 'wysiwyg')])),
      [],
    );
    expect(urls(result)).toEqual(['/relative?a=1&b=2', 'https://example.com']);
  });

  it('parses resource-bearing HTML without constructing browser DOM or starting requests', () => {
    const domParser = vi.fn(() => {
      throw new Error('HTML extraction must not use a browser DOM parser');
    });
    vi.stubGlobal('DOMParser', domParser);
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockImplementation(() => {
        throw new Error('HTML extraction must not create browser elements');
      });
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No network during extraction'));
    try {
      const html = [
        '<img src="https://image.example/file.png">',
        '<iframe src="https://frame.example"></iframe>',
        '<link rel="stylesheet" href="https://style.example/site.css">',
        '<video poster="https://poster.example/file.png"><source src="https://video.example/file.mp4"></video>',
        '<script src="https://script.example/script.js"><a href="https://script-text.example">not markup</a></script>',
        '<style><a href="https://style-text.example">not markup</a></style>',
        '<template><a href="https://template.example">not displayed</a></template>',
        '<code><a href="https://code.example">sample</a></code>',
        '<pre><a href="https://pre.example">sample</a></pre>',
        '<A HREF="https://anchor.example/?a=1&amp;b=2">real anchor</A>',
      ].join('\n');
      const models = schema(
        model('page', [
          field('body', 'text', 'wysiwyg'),
          field('markdown', 'text', 'markdown'),
        ]),
      );
      const result = extractLinks(
        record({
          body: html,
          markdown: '<a href="/docs?x=1&amp;y=2">docs</a>',
        }),
        models,
        [],
      );
      expect(urls(result)).toEqual([
        'https://anchor.example/?a=1&b=2',
        '/docs?x=1&y=2',
      ]);
      expect(domParser).not.toHaveBeenCalled();
      expect(createElement).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      createElement.mockRestore();
      fetch.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('traverses localized owned blocks and both kinds of Structured Text blocks without crawling references', () => {
    const contentSchema = schema(
      model('page', [field('sections', 'rich_text', 'rich_text', true)]),
      model(
        'hero',
        [
          field('link'),
          field('body', 'structured_text', 'structured_text'),
          field('single', 'single_block', 'single_block'),
          field('reference', 'link', 'link'),
          field('json', 'json', 'json'),
        ],
        true,
      ),
      model('cta', [field('url')], true),
    );
    const hero = block(
      'hero',
      {
        link: 'https://hero.example',
        body: dast([
          {
            type: 'paragraph',
            children: [
              { type: 'link', url: '/relative', children: [] },
              {
                type: 'itemLink',
                item: 'reference-record',
                children: [{ type: 'span', value: 'https://label.example' }],
              },
              { type: 'inlineItem', item: 'inline-reference' },
              {
                type: 'inlineBlock',
                item: block('cta', { url: 'https://inline.example' }),
              },
            ],
          },
          {
            type: 'block',
            item: block('cta', { url: 'https://block.example' }, 'b2'),
          },
          { type: 'code', code: 'https://code.example' },
        ]),
        single: block('cta', { url: 'https://single.example' }),
        reference: 'reference-record',
        json: { url: 'https://json.example' },
      },
      'hero-1',
    );
    const result = extractLinks(
      record({ sections: { en: [hero], it: [] } }),
      contentSchema,
      ['en'],
    );
    expect(urls(result)).toEqual([
      'https://hero.example',
      '/relative',
      'https://inline.example',
      'https://block.example',
      'https://single.example',
    ]);
    expect(
      result.occurrences.every((entry) => entry.fieldPath === 'sections.en'),
    ).toBe(true);
    expect(result.occurrences.every((entry) => entry.locale === 'en')).toBe(
      true,
    );
    expect(result.occurrences[2].blockPath).toEqual([
      'sections',
      'hero 1',
      'body',
      'cta',
    ]);
    expect(new Set(result.occurrences.map((entry) => entry.id)).size).toBe(5);
    expect(result.warnings).toEqual([]);
  });

  it('handles unsaved serialized raw request envelopes and flat CMA nested responses', () => {
    const contentSchema = schema(
      model('page', [field('section', 'single_block', 'single_block')]),
      model('cta', [field('url')], true),
    );
    const unsaved: RecordInput = {
      modelId: 'page',
      title: 'New page',
      values: {
        data: block('page', {
          section: block('cta', { url: 'https://unsaved.example' }),
        }),
      },
    };
    expect(urls(extractLinks(unsaved, contentSchema, []))).toEqual([
      'https://unsaved.example',
    ]);
    const flat = record({
      section: {
        id: 'cta-1',
        item_type: { id: 'cta', type: 'item_type' },
        url: 'https://flat.example',
      },
    });
    expect(urls(extractLinks(flat, contentSchema, []))).toEqual([
      'https://flat.example',
    ]);
  });

  it('uses schema localization and does not mistake user fields named data or attributes for envelopes', () => {
    const contentSchema = schema(
      model('page', [
        field('url', 'string', 'single_line', true),
        field('shared'),
        field('data', 'json', 'json'),
        field('attributes', 'json', 'json'),
      ]),
    );
    const result = extractLinks(
      record({
        url: { en: 'https://english.example', it: 'https://italian.example' },
        shared: 'https://shared.example',
        data: { attributes: { bad: 'https://wrong.example' } },
        attributes: { another: 'https://also-wrong.example' },
      }),
      contentSchema,
      ['it'],
    );
    expect(urls(result)).toEqual([
      'https://italian.example',
      'https://shared.example',
    ]);
    expect(result.occurrences[0]).toMatchObject({
      fieldPath: 'url.it',
      locale: 'it',
    });
    expect(result.occurrences[1].locale).toBeUndefined();
  });

  it('reports schema gaps, unhydrated blocks and malformed data instead of a falsely clean scan', () => {
    const contentSchema = schema(
      model('page', [
        field('sections', 'rich_text', 'rich_text'),
        field('body', 'structured_text', 'structured_text'),
        field('url', 'string', 'single_line', true),
      ]),
    );
    const result = extractLinks(
      record({
        sections: [
          'unloaded-block',
          block('missing-model', { url: 'https://hidden.example' }),
        ],
        body: { schema: 'dast', document: { type: 'root' } },
        url: 'not-a-locale-map',
      }),
      contentSchema,
      ['en'],
    );
    expect(result.occurrences).toEqual([]);
    expect(result.warnings).toHaveLength(4);
    expect(extractLinks(record({}), new Map(), []).warnings).toHaveLength(1);
  });

  it('does not reinterpret custom editor values, assets or arbitrary JSON as links', () => {
    const result = extractLinks(
      record({
        body: '<a href="https://custom.example">Custom</a>',
        structured: dast([
          { type: 'link', url: 'https://custom-dast.example' },
        ]),
        data: { url: 'https://json.example' },
        asset: { url: 'https://asset.example' },
        gallery: [{ url: 'https://gallery.example' }],
      }),
      schema(
        model('page', [
          field('body', 'text', 'custom-editor'),
          field('structured', 'structured_text', 'custom-editor'),
          field('data', 'json', 'json'),
          field('asset', 'file', 'file'),
          field('gallery', 'gallery', 'gallery'),
        ]),
      ),
      [],
    );
    expect(result).toEqual({ occurrences: [], warnings: [] });
  });

  it('terminates malformed cyclic nested content with an incomplete warning', () => {
    const contentSchema = schema(
      model('page', [field('section', 'single_block', 'single_block')]),
      model('cta', [field('next', 'single_block', 'single_block')], true),
    );
    const cyclic = block('cta', {});
    cyclic.attributes.next = cyclic;
    const result = extractLinks(record({ section: cyclic }), contentSchema, []);
    expect(result.occurrences).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});
