import { describe, expect, it } from 'vitest';
import { matchText } from '../selection/matcher';
import type { MatcherSpec, TextMatch } from '../selection/types';
import {
  compileReplacementTemplate,
  expandReplacement,
  isNoOpMatch,
  literalTemplate,
  type ReplacementTemplate,
  type TemplateCompilation,
  templateReplacer,
} from './replacementTemplate';

const regex = (pattern: string, caseSensitive = true): MatcherSpec => ({
  kind: 'regex',
  pattern,
  caseSensitive,
  wholeWord: false,
});

const literal = (pattern: string): MatcherSpec => ({
  kind: 'literal',
  pattern,
  caseSensitive: true,
  wholeWord: false,
});

function compiled(
  compilation: TemplateCompilation,
): Extract<TemplateCompilation, { ok: true }> {
  if (!compilation.ok) throw new Error('Expected the template to compile');
  return compilation;
}

function firstMatch(text: string, spec: MatcherSpec): TextMatch {
  const [match] = matchText(text, spec);
  if (!match) throw new Error(`No match for ${spec.pattern} in ${text}`);
  return match;
}

/** Native `String.prototype.replace` at the match position (sticky regex). */
function nativeExpansion(
  text: string,
  spec: MatcherSpec,
  match: TextMatch,
  template: string,
): string {
  const sticky = new RegExp(spec.pattern, `uy${spec.caseSensitive ? '' : 'i'}`);
  sticky.lastIndex = match.start;
  const replaced = text.replace(sticky, template);
  return replaced.slice(
    match.start,
    replaced.length - (text.length - match.end),
  );
}

function expand(text: string, spec: MatcherSpec, template: string): string {
  return expandReplacement(
    compiled(compileReplacementTemplate(template, spec)).template,
    firstMatch(text, spec),
  );
}

/** Deterministic PRNG (mulberry32) so the random cases are reproducible. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

describe('compileReplacementTemplate', () => {
  it('expands groups, names, the match and $$ like JavaScript', () => {
    const spec = regex('(?<first>\\w+) (\\w+)');
    const compilation = compiled(
      compileReplacementTemplate('$2, $<first> ($&) $$ $3 $10', spec),
    );

    expect(
      expandReplacement(compilation.template, firstMatch('John Smith', spec)),
    ).toBe('Smith, John (John Smith) $ $3 John0');
    expect(compilation.outOfRange).toEqual(['$3']);
  });

  it('follows the two-digit fallback rules', () => {
    expect(expand('abc', regex('a(b)c'), '[$10]')).toBe('[b0]');
    expect(expand('abc', regex('a(b)c'), '[$01]')).toBe('[b]');
    expect(expand('abc', regex('a(b)c'), '[$0][$00]')).toBe('[$0][$00]');
    expect(
      expand(
        'abcdefghijk',
        regex('(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)'),
        '$11-$10-$1',
      ),
    ).toBe('k-j-a');
  });

  it('expands an unmatched optional group to nothing', () => {
    expect(expand('b', regex('(a)?b'), '[$1]')).toBe('[]');
    expect(expand('b', regex('(?<x>a)?b'), '[$<x>]')).toBe('[]');
  });

  it('keeps $<name> literal when the pattern has no named groups', () => {
    const compilation = compiled(
      compileReplacementTemplate('$<x>', regex('(a)')),
    );
    expect(compilation.template).toEqual({
      kind: 'pattern',
      parts: [{ type: 'text', value: '$<x>' }],
    });
    expect(compilation.outOfRange).toEqual([]);
  });

  it('reports references to groups the pattern does not have', () => {
    expect(
      compiled(compileReplacementTemplate('$1 $2 $<y> $<x>', regex('(?<x>a)')))
        .outOfRange,
    ).toEqual(['$2', '$<y>']);
    expect(
      compiled(compileReplacementTemplate('$10 $0', regex('abc'))).outOfRange,
    ).toEqual(['$10']);
    expect(expand('a', regex('(?<x>a)'), '[$<constructor>]')).toBe('[]');
  });

  it('keeps a literal replacement verbatim', () => {
    const compilation = compiled(
      compileReplacementTemplate('$1 & $$ $<x> $`', literal('Acme')),
    );
    expect(compilation).toEqual({
      ok: true,
      template: { kind: 'literal', text: '$1 & $$ $<x> $`' },
      outOfRange: [],
    });
    expect(
      expandReplacement(compilation.template, { matchedText: 'Acme' }),
    ).toBe('$1 & $$ $<x> $`');
  });

  it("rejects the context tokens $` and $'", () => {
    expect(compileReplacementTemplate('a$`b', regex('a'))).toEqual({
      ok: false,
      code: 'context_token',
    });
    expect(compileReplacementTemplate("a$'b", regex('a'))).toEqual({
      ok: false,
      code: 'context_token',
    });
    expect(compileReplacementTemplate('a$$`b', regex('a')).ok).toBe(true);
  });

  it('treats a lone or unknown $ as text', () => {
    expect(expand('abc', regex('b'), 'x$')).toBe('x$');
    expect(expand('abc', regex('b'), '$x$<')).toBe('$x$<');
    expect(expand('abc', regex('(?<n>b)'), '$<n')).toBe('$<n');
  });

  it('agrees with String.prototype.replace on random templates and patterns', () => {
    const cases: ReadonlyArray<[MatcherSpec, string]> = [
      [regex('(\\w+) (\\w+)'), 'John Smith and Jane Doe'],
      [regex('(?<first>\\w+) (?<last>\\w+)'), 'Ada Lovelace'],
      [regex('(a)?(b)(?<c>c)?'), 'xbx abc'],
      [regex('(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)'), '--abcdefghijk--'],
      [regex('Acme(\\w*)', false), 'Buy ACMEwidget now'],
      [regex('\\d+'), 'order 12345'],
      [regex('(?<n>x)|(?<m>y)'), 'zzy'],
      [regex('(💩)(\\p{L}+)'), 'a💩été'],
    ];
    const tokens = [
      '$$',
      '$&',
      '$',
      '$0',
      '$00',
      '$1',
      '$2',
      '$3',
      '$9',
      '$01',
      '$10',
      '$11',
      '$12',
      '$99',
      '$<first>',
      '$<last>',
      '$<c>',
      '$<n>',
      '$<m>',
      '$<missing>',
      '$<',
      '<',
      '>',
      'a',
      ' ',
      '0',
      '1',
      '-',
      '💩',
    ];
    const next = random(20260928);
    let checked = 0;

    for (let round = 0; round < 200; round += 1) {
      const [spec, text] = cases[Math.floor(next() * cases.length)] ?? [
        regex('a'),
        'a',
      ];
      const length = Math.floor(next() * 7);
      let template = '';
      for (let index = 0; index < length; index += 1) {
        template += tokens[Math.floor(next() * tokens.length)] ?? '';
      }

      const compilation = compiled(compileReplacementTemplate(template, spec));
      for (const match of matchText(text, spec)) {
        expect(
          expandReplacement(compilation.template, match),
          `${template} on /${spec.pattern}/ at ${match.start}`,
        ).toBe(nativeExpansion(text, spec, match, template));
        checked += 1;
      }
    }

    expect(checked).toBeGreaterThan(200);
  });
});

describe('expandReplacement', () => {
  const template: ReplacementTemplate = compiled(
    compileReplacementTemplate('$1!', regex('Ac(me)')),
  ).template;

  it('uses captures carried by the match (they survive structured clone)', () => {
    const match = structuredClone(firstMatch('Acme', regex('Ac(me)')));
    expect(expandReplacement(template, match)).toBe('me!');
    expect(templateReplacer(template)(match)).toBe('me!');
  });

  it('detects matches whose replacement equals the matched text', () => {
    expect(isNoOpMatch(literalTemplate('Acme'), { matchedText: 'Acme' })).toBe(
      true,
    );
    expect(isNoOpMatch(literalTemplate('Acme'), { matchedText: 'ACME' })).toBe(
      false,
    );
    const same = compiled(
      compileReplacementTemplate('$&', regex('a+')),
    ).template;
    expect(isNoOpMatch(same, firstMatch('baaa', regex('a+')))).toBe(true);
  });
});
