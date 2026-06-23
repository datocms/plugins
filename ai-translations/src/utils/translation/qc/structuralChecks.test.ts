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

  it('flags an error when a block is dropped', () => {
    const flag = checkHtmlStructure({
      source: '<p>One</p><p>Two</p>',
      translated: '<p>Een</p>',
      fieldPath: 'body',
    });
    expect(flag).toMatchObject({
      checkId: 'html-structure',
      severity: 'error',
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
});
