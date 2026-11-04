import { describe, expect, it } from 'vitest';
import {
  attributeEncoder,
  encodedTextEncoder,
  jsonTextEncoder,
  projectEncodedText,
  projectJsonText,
} from './encodedText';

const texts = (flows: ReturnType<typeof projectEncodedText>) =>
  flows.map((flow) => flow.text);

describe('projectEncodedText', () => {
  it('decodes named and numeric entities, leaving unknown ones as written', () => {
    expect(
      texts(
        projectEncodedText('&uuml;ber &#252;ber &#xFC;ber &bogus; &', false),
      ),
    ).toEqual(['über über über &bogus; &']);
  });

  it('maps each entity to its raw characters', () => {
    const [flow] = projectEncodedText('a&uuml;b', false);
    expect(flow?.segments).toEqual([
      { path: [], projectedStart: 0, projectedEnd: 1, rawStart: 0 },
      { path: [], projectedStart: 1, projectedEnd: 2, rawStart: 1, rawEnd: 7 },
      { path: [], projectedStart: 2, projectedEnd: 3, rawStart: 7 },
    ]);
  });

  it('reads non-breaking spaces as spaces', () => {
    const nbsp = String.fromCharCode(0xa0);
    expect(texts(projectEncodedText(`a&nbsp;b${nbsp}c`, false))).toEqual([
      'a b c',
    ]);
  });

  it('keeps tags as text without markup', () => {
    expect(texts(projectEncodedText('<p>a &lt; b</p>', false))).toEqual([
      '<p>a < b</p>',
    ]);
  });

  it('leaves markup out of HTML and splits it at block tags and links', () => {
    expect(
      texts(
        projectEncodedText(
          '<h2 class="x">Title</h2><p>One <em>two</em><br>three <a href="/?a=1&amp;b=>">link</a> end</p><!-- note --><script>var a = "<p>";</script><p>a < b</p>',
          true,
        ),
      ),
    ).toEqual([
      'Title',
      'One two',
      'three ',
      '/?a=1&b=>',
      'link',
      ' end',
      'a < b',
    ]);
  });

  it('gives each link URL a flow of its own, marked as one', () => {
    const flows = projectEncodedText(
      `<p>Go <a data-href="no" href='https://a.de/?x=1&amp;y=2'>here</a>, <a href=/b>b</a> or <a href="">c</a></p>`,
      true,
    );
    expect(texts(flows)).toEqual([
      'Go ',
      'https://a.de/?x=1&y=2',
      'here',
      ', ',
      '/b',
      'b',
      ' or ',
      'c',
    ]);
    expect(flows[1]?.segments).toEqual([
      {
        path: [],
        projectedStart: 0,
        projectedEnd: 17,
        rawStart: 30,
        subfield: 'link_url',
      },
      {
        path: [],
        projectedStart: 17,
        projectedEnd: 18,
        rawStart: 47,
        rawEnd: 52,
        subfield: 'link_url',
      },
      {
        path: [],
        projectedStart: 18,
        projectedEnd: 21,
        rawStart: 52,
        subfield: 'link_url',
      },
    ]);
  });
});

describe('encodedTextEncoder', () => {
  it('writes characters the value stores as entities with the same entity', () => {
    const encode = encodedTextEncoder('&Uuml;ber &#252;ber &auml;', false);
    expect(encode('Über üben & Ä <b>')).toBe('&Uuml;ber &#252;ben & Ä <b>');
  });

  it('escapes &, < and > in HTML', () => {
    expect(encodedTextEncoder('<p>plain</p>', true)('a & <b> ü')).toBe(
      'a &amp; &lt;b&gt; ü',
    );
  });

  it('also escapes quotes in an attribute value', () => {
    const encode = attributeEncoder(encodedTextEncoder('<p>plain</p>', true));
    expect(encode(`a"b'c&d`)).toBe('a&quot;b&#39;c&amp;d');
  });
});

describe('projectJsonText', () => {
  it('projects string values, not keys, numbers or structure', () => {
    expect(
      texts(
        projectJsonText(
          '{"name": "Laptop", "tags": ["a", "b"], "price": 4, "nested": {"key" : "value"}, "empty": ""}',
        ),
      ),
    ).toEqual(['Laptop', 'a', 'b', 'value']);
  });

  it('decodes escapes, surrogate pairs included', () => {
    const raw = '["line\\nbreak \\"quoted\\" \\u00fc \\ud83d\\ude00 \\/"]';
    const [flow] = projectJsonText(raw);
    expect(flow?.text).toBe(
      `line\nbreak "quoted" ü ${String.fromCodePoint(0x1f600)} /`,
    );
    const emoji = flow?.segments.find(
      (segment) =>
        segment.rawEnd !== undefined &&
        segment.projectedEnd - segment.projectedStart === 2,
    );
    expect(emoji && raw.slice(emoji.rawStart, emoji.rawEnd)).toBe(
      '\\ud83d\\ude00',
    );
  });

  it('has nothing to match in invalid JSON', () => {
    expect(projectJsonText('{"a": ')).toEqual([]);
  });
});

describe('jsonTextEncoder', () => {
  it('escapes for a JSON string', () => {
    expect(jsonTextEncoder('{"a": "ü"}')('say "hi"\n ü')).toBe(
      'say \\"hi\\"\\n ü',
    );
  });

  it('keeps non-ASCII escaped when the value escapes it', () => {
    expect(jsonTextEncoder('{"a": "\\u00fc"}')('ä')).toBe('\\u00e4');
  });
});
