import { describe, expect, it } from 'vitest';
import {
  checkHtmlStructure,
  checkLengthRatio,
  checkMarkdownStructure,
  checkNoOp,
} from './structuralChecks';

describe('checkHtmlStructure', () => {
  it('returns null when the block structure matches', () => {
    expect(
      checkHtmlStructure({
        source: '<p>One</p><p>Two</p>',
        translated: '<p>Een</p><p>Twee</p>',
      }),
    ).toBeNull();
  });

  it('flags a warning when only paragraph count changes', () => {
    const flag = checkHtmlStructure({
      source: '<p>One</p><p>Two</p>',
      translated: '<p>Een</p>',
      fieldPath: 'body',
    });
    expect(flag).toMatchObject({
      checkId: 'paragraph-count',
      severity: 'warning',
      fieldPath: 'body',
    });
  });

  it('ignores inline-emphasis and attribute differences', () => {
    expect(
      checkHtmlStructure({
        source: '<p data-path-to-node="0">a <strong>b</strong></p>',
        translated: '<p>a b</p>',
      }),
    ).toBeNull();
  });
});

describe('checkHtmlStructure paragraph reclassification', () => {
  it('treats a paragraph-count-only difference as a heuristic warning', () => {
    const flag = checkHtmlStructure({
      source: '<p>one</p><p>two</p>',
      translated: '<p>one two merged</p>',
    });
    expect(flag?.checkId).toBe('paragraph-count');
    expect(flag?.severity).toBe('warning');
  });
  it('still errors when a structural block (heading) is lost', () => {
    const flag = checkHtmlStructure({
      source: '<h2>Title</h2><p>body</p>',
      translated: '<p>body</p>',
    });
    expect(flag?.checkId).toBe('html-structure');
    expect(flag?.severity).toBe('error');
  });
  it('passes identical structure', () => {
    expect(checkHtmlStructure({ source: '<p>a</p>', translated: '<p>b</p>' })).toBeNull();
  });
});

describe('checkMarkdownStructure', () => {
  it('returns null when block structure matches', () => {
    expect(
      checkMarkdownStructure({
        source: '## Title\n\nPara one\n\nPara two',
        translated: '## Titel\n\nAlinea een\n\nAlinea twee',
      }),
    ).toBeNull();
  });

  it('flags an error when a heading is dropped', () => {
    const flag = checkMarkdownStructure({
      source: '## Title\n\nPara',
      translated: 'Para',
    });
    expect(flag).toMatchObject({ checkId: 'markdown-structure', severity: 'error' });
  });

  it('flags a warning on paragraph-count drift only', () => {
    const flag = checkMarkdownStructure({
      source: '# T\n\nA\n\nB\n\nC',
      translated: '# T\n\nA\n\nB',
    });
    expect(flag).toMatchObject({
      checkId: 'markdown-structure',
      severity: 'warning',
    });
  });

  it('does not mistake a year opening a prose sentence for an ordered-list item', () => {
    // "2020. A pivotal year…" is prose, not a list. A correct translation may
    // reorder the year, which used to read as a "missing ol-item" error.
    expect(
      checkMarkdownStructure({
        source: '2020. A pivotal year for the company.',
        translated: 'Ein entscheidendes Jahr für das Unternehmen: 2020.',
      }),
    ).toBeNull();
  });

  it('still tracks real ordered-list items', () => {
    const flag = checkMarkdownStructure({
      source: '1. First step\n2. Second step',
      translated: 'Erster Schritt ohne Nummerierung',
    });
    expect(flag).toMatchObject({ checkId: 'markdown-structure', severity: 'error' });
  });

  it('flags an error when a link is dropped', () => {
    const flag = checkMarkdownStructure({
      source: 'Read [the docs](https://example.com) before starting.',
      translated: 'Lees dit voordat je begint.',
    });
    expect(flag).toMatchObject({
      checkId: 'markdown-structure',
      severity: 'error',
    });
  });

  it('flags an error when an image is dropped', () => {
    const flag = checkMarkdownStructure({
      source: 'Intro\n\n![diagram](diagram.png)\n\nOutro',
      translated: 'Intro\n\nGeen afbeelding\n\nOutro',
    });
    expect(flag).toMatchObject({
      checkId: 'markdown-structure',
      severity: 'error',
    });
  });

  it('does not flag when only link anchor text is rephrased', () => {
    expect(
      checkMarkdownStructure({
        source: 'See [the official docs](https://example.com) here.',
        translated: 'Zie [de officiële documentatie](https://example.com) hier.',
      }),
    ).toBeNull();
  });
});

describe('checkNoOp', () => {
  it('returns null when content was translated', () => {
    expect(
      checkNoOp({ sources: ['Hello world'], translateds: ['Hallo wereld'] }),
    ).toBeNull();
  });

  it('warns when a single long value is unchanged', () => {
    const flag = checkNoOp({
      sources: ['The quick brown fox jumps'],
      translateds: ['The quick brown fox jumps'],
      fieldPath: 'body',
    });
    expect(flag).toMatchObject({ checkId: 'no-op', severity: 'warning' });
  });

  it('does not warn on one identical proper noun among translated segments', () => {
    expect(
      checkNoOp({
        sources: ['Hello there friend', 'DatoCMS', 'Goodbye for now'],
        translateds: ['Hallo daar vriend', 'DatoCMS', 'Tot ziens voorlopig'],
      }),
    ).toBeNull();
  });

  it('exempts numeric-only and very short segments', () => {
    expect(
      checkNoOp({ sources: ['2024', 'OK'], translateds: ['2024', 'OK'] }),
    ).toBeNull();
  });
});

describe('checkLengthRatio', () => {
  it('returns null for a normal-length translation', () => {
    expect(
      checkLengthRatio({
        source: 'This is a sentence of reasonable length.',
        translated: 'Dit is een zin van redelijke lengte.',
      }),
    ).toBeNull();
  });

  it('warns when the translation is far shorter than a long source', () => {
    const flag = checkLengthRatio({
      source:
        'This is a long source sentence that carries a lot of meaningful content for translation.',
      translated: 'Kort.',
      fieldPath: 'body',
    });
    expect(flag).toMatchObject({ checkId: 'length-ratio', severity: 'warning' });
  });

  it('skips very short sources where ratios are noise', () => {
    expect(checkLengthRatio({ source: 'Hi there', translated: 'H' })).toBeNull();
  });

  it('does not flag a legitimately compact CJK translation of a Latin source', () => {
    // CJK packs far more information per character: a correct zh translation
    // routinely lands at 20-30% of the Latin source's character count. The
    // fixed 30% floor false-alarmed on essentially every substantial en→zh/ja
    // field; a predominantly-CJK translation gets a lower floor instead.
    expect(
      checkLengthRatio({
        source: 'Get started with our platform today and explore every feature.',
        translated: '立即开始使用我们的平台',
      }),
    ).toBeNull();
  });

  it('still flags a truly truncated CJK translation', () => {
    const flag = checkLengthRatio({
      source:
        'This long marketing paragraph describes the product, its capabilities, its pricing tiers, and the onboarding steps a new customer follows.',
      translated: '产品',
    });
    expect(flag).toMatchObject({ checkId: 'length-ratio', severity: 'warning' });
  });
});
