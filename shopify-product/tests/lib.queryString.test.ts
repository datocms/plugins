import { describe, expect, it } from 'vitest';
import {
  buildCollectionProductFilters,
  buildCollectionSearchQuery,
  buildProductSearchQuery,
  type CollectionFilterSupport,
  defaultSort,
  enabledCollectionFilters,
  escapeSearchValue,
  isSortAvailable,
  mergeScopeTags,
  PICKER_SORT_OPTIONS,
  type PickerSort,
  type ProductSearchInput,
  resolveSort,
  toCollectionSort,
  toProductSort,
} from '../src/lib/queryString';
import type { ShopifyFilter } from '../src/types';

/**
 * Asserts the query can't be read as Shopify syntax: once escaped characters
 * and balanced phrases are removed, no syntax character (including the range
 * operators `<` and `>`), leading dash or uppercase operator is left.
 */
function expectNoBareSyntax(query: string) {
  const bare = query.replace(/\\./g, '').replace(/"[^"]*"/g, ' ');
  expect(bare, query).not.toMatch(/["':()*\\<>]/);
  expect(bare, query).not.toMatch(/(^|\s)-/);
  expect(bare, query).not.toMatch(/(^|\s)(AND|OR|NOT)(?=\s|$)/);
}

/** A filter value: a quoted phrase, or a bare word with no syntax in it. */
const SAFE_VALUE = String.raw`(?:"(?:[^"\\]|\\.)*"|(?!(?:AND|OR|NOT)(?:[\s)]|$))[^\s:()"'\\*<>-][^\s:()"'\\*<>]*)`;
const FIELD_CLAUSE = `(?:product_type|vendor|tag|tag_not|available_for_sale):${SAFE_VALUE}`;
const TAG_GROUP = String.raw`\(tag:${SAFE_VALUE}(?: OR tag:${SAFE_VALUE})+\)`;
const CLAUSE = `(?:${FIELD_CLAUSE}|${TAG_GROUP})`;
const FILTER_QUERY = new RegExp(`^${CLAUSE}(?: AND ${CLAUSE})*$`);

/**
 * Asserts a filter-only query is nothing but `field:value` clauses (and one
 * `(tag:… OR tag:…)` group) joined with AND, with every value either quoted
 * or free of syntax, so no value can become a range, a field or an operator.
 */
function expectOnlyFilterSyntax(query: string | undefined) {
  expect(query).toBeDefined();
  expect(query ?? '', query).toMatch(FILTER_QUERY);
}

describe('escapeSearchValue', () => {
  it('leaves plain values unquoted', () => {
    expect(escapeSearchValue('snowboard')).toBe('snowboard');
    expect(escapeSearchValue('Multi-managed')).toBe('Multi-managed');
    expect(escapeSearchValue('café')).toBe('café');
    expect(escapeSearchValue('日本')).toBe('日本');
    expect(escapeSearchValue('3p')).toBe('3p');
  });

  it('quotes values with whitespace', () => {
    expect(escapeSearchValue('DatoCMS Demo')).toBe('"DatoCMS Demo"');
    expect(escapeSearchValue('a\tb')).toBe('"a\tb"');
    expect(escapeSearchValue('a\nb')).toBe('"a\nb"');
    expect(escapeSearchValue(' ')).toBe('" "');
  });

  it('escapes backslashes and double quotes inside quotes', () => {
    expect(escapeSearchValue('a"b')).toBe('"a\\"b"');
    expect(escapeSearchValue('a\\b')).toBe('"a\\\\b"');
    expect(escapeSearchValue('\\"')).toBe('"\\\\\\""');
    expect(escapeSearchValue('"')).toBe('"\\""');
    expect(escapeSearchValue('\\')).toBe('"\\\\"');
  });

  it('quotes every search syntax character', () => {
    expect(escapeSearchValue('vendor:foo')).toBe('"vendor:foo"');
    expect(escapeSearchValue('(a)')).toBe('"(a)"');
    expect(escapeSearchValue('a)')).toBe('"a)"');
    expect(escapeSearchValue('snow*')).toBe('"snow*"');
    expect(escapeSearchValue("men's")).toBe('"men\'s"');
    expect(escapeSearchValue('*')).toBe('"*"');
  });

  it('quotes range operators, which Shopify reads after a field colon', () => {
    expect(escapeSearchValue('<1kg')).toBe('"<1kg"');
    expect(escapeSearchValue('>A')).toBe('">A"');
    expect(escapeSearchValue('>=10')).toBe('">=10"');
    expect(escapeSearchValue('<=10')).toBe('"<=10"');
    expect(escapeSearchValue('<')).toBe('"<"');
    expect(escapeSearchValue('>')).toBe('">"');
    expect(escapeSearchValue('Hydrogen<Z')).toBe('"Hydrogen<Z"');
    expect(escapeSearchValue('Snow>')).toBe('"Snow>"');
    for (const value of ['<1kg', '>Hydrogen', '>=Premium', '<=x', 'a>b']) {
      expectNoBareSyntax(escapeSearchValue(value));
    }
  });

  it('leaves a leading equals sign alone (verified harmless)', () => {
    expect(escapeSearchValue('=Premium')).toBe('=Premium');
  });

  it('quotes a leading dash but not an inner one', () => {
    expect(escapeSearchValue('-snowboard')).toBe('"-snowboard"');
    expect(escapeSearchValue('-')).toBe('"-"');
    expect(escapeSearchValue('t-shirt')).toBe('t-shirt');
  });

  it('quotes bare operators and the empty value', () => {
    expect(escapeSearchValue('OR')).toBe('"OR"');
    expect(escapeSearchValue('AND')).toBe('"AND"');
    expect(escapeSearchValue('NOT')).toBe('"NOT"');
    expect(escapeSearchValue('or')).toBe('or');
    expect(escapeSearchValue('')).toBe('""');
  });

  it('turns injection attempts into a single quoted phrase', () => {
    const value = 'x" OR vendor:y OR "z';
    const escaped = escapeSearchValue(value);
    expect(escaped).toBe('"x\\" OR vendor:y OR \\"z"');
    expectNoBareSyntax(escaped);
  });
});

describe('buildProductSearchQuery: free text', () => {
  it('returns undefined when there is nothing to search', () => {
    expect(buildProductSearchQuery({})).toBeUndefined();
    expect(buildProductSearchQuery({ text: '' })).toBeUndefined();
    expect(buildProductSearchQuery({ text: '   ' })).toBeUndefined();
    expect(buildProductSearchQuery({ text: '\t\n' })).toBeUndefined();
    expect(buildProductSearchQuery({ text: '""' })).toBeUndefined();
    expect(buildProductSearchQuery({ text: '"   "' })).toBeUndefined();
  });

  it('keeps bare words as prefix terms (Shopify ANDs them)', () => {
    expect(buildProductSearchQuery({ text: 'snow' })).toBe('snow');
    expect(buildProductSearchQuery({ text: 'complete snow' })).toBe(
      'complete snow',
    );
    expect(buildProductSearchQuery({ text: '  compl   snow  ' })).toBe(
      'compl snow',
    );
    expect(buildProductSearchQuery({ text: 'multi-loc' })).toBe('multi-loc');
    expect(buildProductSearchQuery({ text: 'sku-managed-1' })).toBe(
      'sku-managed-1',
    );
  });

  it('keeps unicode untouched', () => {
    expect(buildProductSearchQuery({ text: 'café' })).toBe('café');
    expect(buildProductSearchQuery({ text: 'Ünïcödé 日本 🏂' })).toBe(
      'Ünïcödé 日本 🏂',
    );
  });

  it('keeps balanced quoted phrases as exact phrases', () => {
    expect(buildProductSearchQuery({ text: '"complete snowboard"' })).toBe(
      '"complete snowboard"',
    );
    expect(buildProductSearchQuery({ text: '"  complete   snowboard "' })).toBe(
      '"complete snowboard"',
    );
    expect(
      buildProductSearchQuery({ text: 'gift "complete snowboard" snow' }),
    ).toBe('gift "complete snowboard" snow');
  });

  it('keeps field syntax literal', () => {
    expect(buildProductSearchQuery({ text: 'vendor:foo' })).toBe(
      'vendor\\:foo',
    );
    expect(buildProductSearchQuery({ text: 'sku:xyz' })).toBe('sku\\:xyz');
    expect(buildProductSearchQuery({ text: 'title:"foo"' })).toBe(
      'title\\:\\"foo\\"',
    );
    expect(buildProductSearchQuery({ text: 'created_at:>2020' })).toBe(
      'created_at\\:\\>2020',
    );
    expect(buildProductSearchQuery({ text: 'Snowboard: Hydr' })).toBe(
      'Snowboard\\: Hydr',
    );
    expect(buildProductSearchQuery({ text: ':' })).toBe('\\:');
  });

  it('escapes quotes, backslashes, parentheses and wildcards', () => {
    expect(buildProductSearchQuery({ text: '"' })).toBe('\\"');
    expect(buildProductSearchQuery({ text: "'" })).toBe("\\'");
    expect(buildProductSearchQuery({ text: "'complete snow'" })).toBe(
      "\\'complete snow\\'",
    );
    expect(buildProductSearchQuery({ text: "men's" })).toBe("men\\'s");
    expect(buildProductSearchQuery({ text: '\\' })).toBe('\\\\');
    expect(buildProductSearchQuery({ text: 'a\\b' })).toBe('a\\\\b');
    expect(buildProductSearchQuery({ text: '(' })).toBe('\\(');
    expect(buildProductSearchQuery({ text: ')' })).toBe('\\)');
    expect(buildProductSearchQuery({ text: '()' })).toBe('\\(\\)');
    expect(buildProductSearchQuery({ text: '(gift OR hidden)' })).toBe(
      '\\(gift or hidden\\)',
    );
    expect(buildProductSearchQuery({ text: '*' })).toBe('\\*');
    expect(buildProductSearchQuery({ text: 'snow*' })).toBe('snow\\*');
    expect(buildProductSearchQuery({ text: 'sn*w' })).toBe('sn\\*w');
  });

  it('escapes unbalanced and stray double quotes', () => {
    expect(buildProductSearchQuery({ text: '"unbalanced' })).toBe(
      '\\"unbalanced',
    );
    expect(buildProductSearchQuery({ text: 'gift"' })).toBe('gift\\"');
    expect(buildProductSearchQuery({ text: 'complete "snow' })).toBe(
      'complete \\"snow',
    );
    expect(buildProductSearchQuery({ text: '"a" "b' })).toBe('"a" \\"b');
  });

  it('escapes backslashes inside phrases', () => {
    expect(buildProductSearchQuery({ text: '"gift\\"' })).toBe('"gift\\\\"');
  });

  it('escapes a leading dash only', () => {
    expect(buildProductSearchQuery({ text: '-snow' })).toBe('\\-snow');
    expect(buildProductSearchQuery({ text: '-' })).toBe('\\-');
    expect(buildProductSearchQuery({ text: 'gift -card' })).toBe(
      'gift \\-card',
    );
    expect(buildProductSearchQuery({ text: '--x' })).toBe('\\--x');
    expect(buildProductSearchQuery({ text: 't-shirt' })).toBe('t-shirt');
  });

  it('lowercases uppercase operators so they stay literal', () => {
    expect(buildProductSearchQuery({ text: 'AND' })).toBe('and');
    expect(buildProductSearchQuery({ text: 'OR' })).toBe('or');
    expect(buildProductSearchQuery({ text: 'NOT gift' })).toBe('not gift');
    expect(buildProductSearchQuery({ text: 'Gift OR Hidden' })).toBe(
      'Gift or Hidden',
    );
    expect(buildProductSearchQuery({ text: 'ORANGE Not and' })).toBe(
      'ORANGE Not and',
    );
    expect(buildProductSearchQuery({ text: '"black AND white"' })).toBe(
      '"black AND white"',
    );
  });

  it('escapes range operators and leaves other punctuation alone', () => {
    expect(buildProductSearchQuery({ text: '{gift} [x] ~^<>=!+&|?/.,' })).toBe(
      '{gift} [x] ~^\\<\\>=!+&|?/.,',
    );
    expect(buildProductSearchQuery({ text: '<5' })).toBe('\\<5');
    expect(buildProductSearchQuery({ text: '>=snow' })).toBe('\\>=snow');
    expect(buildProductSearchQuery({ text: 'gift<card' })).toBe('gift\\<card');
  });

  it('never produces bare syntax for hostile input', () => {
    const inputs = [
      'vendor:foo',
      'title:x* OR tag:y',
      '-(a OR b)',
      '"open',
      'close"',
      '\\"',
      '\\\\"x',
      "'q' 'r",
      'NOT -x AND (y:z)',
      'a:b:c',
      '***',
      '- - -',
      '"x" OR "y',
      'available_for_sale:false',
      '\\(',
      ')\\',
      '<5',
      '>z',
      '>=snow',
      '<=',
      'price:>=10',
      'tag:<1kg',
      '"a" <b',
    ];
    for (const text of inputs) {
      const query = buildProductSearchQuery({ text });
      expect(query, text).toBeDefined();
      expectNoBareSyntax(query ?? '');
    }
  });
});

describe('buildProductSearchQuery: filters', () => {
  it('builds each filter on its own', () => {
    expect(buildProductSearchQuery({ productType: 'snowboard' })).toBe(
      'product_type:snowboard',
    );
    expect(buildProductSearchQuery({ vendor: 'DatoCMS Demo' })).toBe(
      'vendor:"DatoCMS Demo"',
    );
    expect(buildProductSearchQuery({ tags: ['Sport'] })).toBe('tag:Sport');
    expect(buildProductSearchQuery({ tagsNot: ['Premium'] })).toBe(
      'tag_not:Premium',
    );
    expect(buildProductSearchQuery({ availableOnly: true })).toBe(
      'available_for_sale:true',
    );
  });

  it('never sends available_for_sale:false', () => {
    expect(buildProductSearchQuery({ availableOnly: false })).toBeUndefined();
  });

  it('matches ANY of several tags, trimmed and de-duplicated', () => {
    expect(
      buildProductSearchQuery({
        tags: ['Premium', ' Snow ', 'premium', '', '  '],
      }),
    ).toBe('(tag:Premium OR tag:Snow)');
    expect(buildProductSearchQuery({ tags: ['Premium', 'premium'] })).toBe(
      'tag:Premium',
    );
    expect(buildProductSearchQuery({ tags: ['Gift Card', 'Sale', 'OR'] })).toBe(
      '(tag:"Gift Card" OR tag:Sale OR tag:"OR")',
    );
  });

  it('excludes EVERY tag in tagsNot', () => {
    expect(
      buildProductSearchQuery({
        tags: ['Premium'],
        tagsNot: ['Snow', 'Gift Card'],
      }),
    ).toBe('tag:Premium AND tag_not:Snow AND tag_not:"Gift Card"');
  });

  it('keeps the OR group in parentheses so it ANDs with other filters', () => {
    // Without them Shopify returns 0 for `vendor:Hydrogen AND tag:Premium OR
    // tag:Snow` instead of 4 (verified live).
    expect(
      buildProductSearchQuery({
        text: 'snow',
        vendor: 'Hydrogen',
        tags: ['Accessory', 'Premium'],
        availableOnly: true,
      }),
    ).toBe(
      'snow AND vendor:Hydrogen AND (tag:Accessory OR tag:Premium) AND available_for_sale:true',
    );
  });

  it('ignores empty and whitespace-only filter values', () => {
    expect(
      buildProductSearchQuery({
        productType: '',
        vendor: '   ',
        tags: [],
        tagsNot: [''],
      }),
    ).toBeUndefined();
  });

  it('trims filter values', () => {
    expect(buildProductSearchQuery({ vendor: '  Hydrogen Vendor ' })).toBe(
      'vendor:"Hydrogen Vendor"',
    );
  });

  it('joins text and every filter with AND, text first', () => {
    expect(
      buildProductSearchQuery({
        text: 'compl snow',
        productType: 'snowboard',
        vendor: 'Snowboard Vendor',
        tags: ['Premium', 'Snow'],
        tagsNot: ['Accessory'],
        availableOnly: true,
      }),
    ).toBe(
      'compl snow AND product_type:snowboard AND vendor:"Snowboard Vendor" AND (tag:Premium OR tag:Snow) AND tag_not:Accessory AND available_for_sale:true',
    );
  });

  it('builds every combination of filters in a stable order', () => {
    const parts: Array<[ProductSearchInput, string]> = [
      [{ text: 'gift' }, 'gift'],
      [{ productType: 'snowboard' }, 'product_type:snowboard'],
      [{ vendor: 'Acme' }, 'vendor:Acme'],
      [{ tags: ['Sport'] }, 'tag:Sport'],
      [{ tagsNot: ['Snow'] }, 'tag_not:Snow'],
      [{ availableOnly: true }, 'available_for_sale:true'],
    ];
    for (let mask = 1; mask < 2 ** parts.length; mask += 1) {
      const selected = parts.filter(
        (_, bit) => Math.floor(mask / 2 ** bit) % 2,
      );
      let input: ProductSearchInput = {};
      for (const [part] of selected) input = { ...input, ...part };
      expect(buildProductSearchQuery(input)).toBe(
        selected.map(([, clause]) => clause).join(' AND '),
      );
    }
  });

  it('escapes hostile filter values into one quoted phrase', () => {
    expect(buildProductSearchQuery({ vendor: 'vendor:"x" OR (y)' })).toBe(
      'vendor:"vendor:\\"x\\" OR (y)"',
    );
    expect(buildProductSearchQuery({ productType: '-snowboard' })).toBe(
      'product_type:"-snowboard"',
    );
    expect(buildProductSearchQuery({ vendor: 'OR' })).toBe('vendor:"OR"');
    expect(buildProductSearchQuery({ tags: ['a\\"b'] })).toBe(
      'tag:"a\\\\\\"b"',
    );
    expect(buildProductSearchQuery({ tags: ['*'] })).toBe('tag:"*"');
  });

  it('quotes values that start with a range operator', () => {
    // Bare, these became ranges live: `vendor:>Hydrogen` returned the whole
    // catalog and `tag:<1kg` failed with INTERNAL_SERVER_ERROR.
    expect(buildProductSearchQuery({ vendor: '>Hydrogen' })).toBe(
      'vendor:">Hydrogen"',
    );
    expect(buildProductSearchQuery({ productType: '<snowboard' })).toBe(
      'product_type:"<snowboard"',
    );
    expect(buildProductSearchQuery({ tags: ['<1kg'] })).toBe('tag:"<1kg"');
    expect(buildProductSearchQuery({ tagsNot: ['<1kg'] })).toBe(
      'tag_not:"<1kg"',
    );
    expect(buildProductSearchQuery({ tags: ['>=Premium', '>a'] })).toBe(
      '(tag:">=Premium" OR tag:">a")',
    );
  });

  it('never produces anything but field clauses for hostile filters', () => {
    const hostile = [
      '<1kg',
      '>Hydrogen',
      '>=Premium',
      '<=x',
      '-snowboard',
      'vendor:x',
      'a OR b',
      'OR',
      'NOT',
      '(x)',
      'x)',
      '*',
      'snow*',
      '"',
      '\\',
      'a\\"b',
      "men's",
      'x" OR vendor:y OR "z',
      'café',
      '日本',
      '=Premium',
    ];
    for (const value of hostile) {
      expectOnlyFilterSyntax(buildProductSearchQuery({ vendor: value }));
      expectOnlyFilterSyntax(buildProductSearchQuery({ productType: value }));
      expectOnlyFilterSyntax(buildProductSearchQuery({ tags: [value] }));
      expectOnlyFilterSyntax(buildProductSearchQuery({ tagsNot: [value] }));
      expectOnlyFilterSyntax(
        buildProductSearchQuery({ tags: [value, 'Sale'], tagsNot: [value] }),
      );
    }
    expectOnlyFilterSyntax(
      buildProductSearchQuery({
        productType: hostile[0],
        vendor: hostile[1],
        tags: hostile,
        tagsNot: hostile,
        availableOnly: true,
      }),
    );
  });

  it('rejects bare range or field syntax in the filter checker', () => {
    // Guards the guard: these would have slipped through before.
    for (const query of [
      'vendor:>Hydrogen',
      'tag:<1kg',
      'tag:a OR tag:b',
      'vendor:OR',
      'tag:x:y',
      '(tag:a)',
    ]) {
      expect(query).not.toMatch(FILTER_QUERY);
    }
  });
});

describe('buildCollectionSearchQuery', () => {
  it('returns undefined for empty input', () => {
    expect(buildCollectionSearchQuery('')).toBeUndefined();
    expect(buildCollectionSearchQuery('   ')).toBeUndefined();
    expect(buildCollectionSearchQuery('""')).toBeUndefined();
  });

  it('prefix-searches the title, one clause per word', () => {
    expect(buildCollectionSearchQuery('hy')).toBe('title:hy*');
    expect(buildCollectionSearchQuery('  automated   coll ')).toBe(
      'title:automated* AND title:coll*',
    );
    expect(buildCollectionSearchQuery('HOME')).toBe('title:HOME*');
    expect(buildCollectionSearchQuery('été')).toBe('title:été*');
  });

  it('keeps quoted phrases exact', () => {
    expect(buildCollectionSearchQuery('"automated collection"')).toBe(
      'title:"automated collection"',
    );
    expect(buildCollectionSearchQuery('"summer sale" 2026')).toBe(
      'title:"summer sale" AND title:2026*',
    );
  });

  it('escapes syntax before the wildcard', () => {
    expect(buildCollectionSearchQuery('*')).toBe('title:\\**');
    expect(buildCollectionSearchQuery('auto*')).toBe('title:auto\\**');
    expect(buildCollectionSearchQuery('(')).toBe('title:\\(*');
    expect(buildCollectionSearchQuery('"')).toBe('title:\\"*');
    expect(buildCollectionSearchQuery('\\')).toBe('title:\\\\*');
    expect(buildCollectionSearchQuery('-h')).toBe('title:\\-h*');
    expect(buildCollectionSearchQuery('vendor:x')).toBe('title:vendor\\:x*');
    expect(buildCollectionSearchQuery("kids'")).toBe("title:kids\\'*");
    expect(buildCollectionSearchQuery('AND')).toBe('title:and*');
  });

  it('escapes range operators so the term stays a title prefix', () => {
    // Bare, `title:>*`, `title:>a*` and `title:<z*` returned every collection
    // live; escaped they are literal.
    expect(buildCollectionSearchQuery('>')).toBe('title:\\>*');
    expect(buildCollectionSearchQuery('<')).toBe('title:\\<*');
    expect(buildCollectionSearchQuery('>a')).toBe('title:\\>a*');
    expect(buildCollectionSearchQuery('<z')).toBe('title:\\<z*');
    expect(buildCollectionSearchQuery('>=h')).toBe('title:\\>=h*');
    expect(buildCollectionSearchQuery('a>b')).toBe('title:a\\>b*');
  });

  it('never produces bare syntax inside a title term', () => {
    const inputs = ['>', '<z', '>=a', 'vendor:x', '-h', '(a OR b)', '"x', '*'];
    for (const text of inputs) {
      const query = buildCollectionSearchQuery(text) ?? '';
      const terms = query.split(' AND ').map((clause) => {
        expect(clause, text).toMatch(/^title:/);
        return clause.slice('title:'.length).replace(/\*$/, '');
      });
      expectNoBareSyntax(terms.join(' '));
    }
  });
});

describe('enabledCollectionFilters', () => {
  const availability: ShopifyFilter = {
    id: 'filter.v.availability',
    label: 'Availability',
    type: 'LIST',
    values: [
      {
        id: 'filter.v.availability.1',
        label: 'In stock',
        count: 7,
        input: '{"available":true}',
      },
      {
        id: 'filter.v.availability.0',
        label: 'Out of stock',
        count: 0,
        input: '{"available":false}',
      },
    ],
  };
  const price: ShopifyFilter = {
    id: 'filter.v.price',
    label: 'Price',
    type: 'PRICE_RANGE',
    values: [
      {
        id: 'filter.v.price',
        label: 'Price',
        count: 0,
        input: '{"price":{"min":0,"max":785.95}}',
      },
    ],
  };

  it('reports nothing for an empty list', () => {
    expect(enabledCollectionFilters([])).toEqual({
      availability: false,
      productType: false,
      vendor: false,
      tag: false,
      price: false,
    });
  });

  it('reads the default Search & Discovery filters (recorded live)', () => {
    expect(enabledCollectionFilters([availability, price])).toEqual({
      availability: true,
      productType: false,
      vendor: false,
      tag: false,
      price: true,
    });
  });

  it('recognizes product type, vendor and tag filters by ID', () => {
    const filters: ShopifyFilter[] = [
      'filter.p.product_type',
      'filter.p.vendor',
      'filter.p.tag',
    ].map((id) => ({ id, label: id, type: 'LIST', values: [] }));
    expect(enabledCollectionFilters(filters)).toEqual({
      availability: false,
      productType: true,
      vendor: true,
      tag: true,
      price: false,
    });
  });

  it('also recognizes filters by their value inputs', () => {
    const filter: ShopifyFilter = {
      id: 'custom.vendor-filter',
      label: 'Brand',
      type: 'LIST',
      values: [
        {
          id: 'x',
          label: 'Acme',
          count: 3,
          input: '{"productVendor":"Acme"}',
        },
        { id: 'y', label: 'Shoes', count: 1, input: '{"productType":"Shoes"}' },
        { id: 'z', label: 'Sale', count: 2, input: '{"tag":"Sale"}' },
      ],
    };
    expect(enabledCollectionFilters([filter])).toMatchObject({
      vendor: true,
      productType: true,
      tag: true,
    });
  });

  it('ignores variant option, metafield and malformed filters', () => {
    const filters: ShopifyFilter[] = [
      {
        id: 'filter.v.option.color',
        label: 'Color',
        type: 'LIST',
        values: [
          {
            id: 'a',
            label: 'Red',
            count: 1,
            input: '{"variantOption":{"name":"color","value":"Red"}}',
          },
        ],
      },
      {
        id: 'filter.p.m.custom.material',
        label: 'Material',
        type: 'LIST',
        values: [{ id: 'b', label: 'Wood', count: 1, input: 'not json' }],
      },
      {
        id: 'weird',
        label: 'Weird',
        type: 'LIST',
        values: [{ id: 'c', label: 'Null', count: 1, input: 'null' }],
      },
    ];
    expect(enabledCollectionFilters(filters)).toEqual({
      availability: false,
      productType: false,
      vendor: false,
      tag: false,
      price: false,
    });
  });
});

describe('buildCollectionProductFilters', () => {
  it('returns no filters for empty input', () => {
    expect(buildCollectionProductFilters({})).toEqual([]);
    expect(
      buildCollectionProductFilters({
        availableOnly: false,
        productType: ' ',
        vendor: '',
        tags: ['', ' '],
      }),
    ).toEqual([]);
  });

  it('maps each input to its ProductFilter', () => {
    expect(buildCollectionProductFilters({ availableOnly: true })).toEqual([
      { available: true },
    ]);
    expect(buildCollectionProductFilters({ productType: 'snowboard' })).toEqual(
      [{ productType: 'snowboard' }],
    );
    expect(buildCollectionProductFilters({ vendor: ' Acme ' })).toEqual([
      { productVendor: 'Acme' },
    ]);
    expect(
      buildCollectionProductFilters({ tags: ['Sale', 'New', 'sale'] }),
    ).toEqual([{ tag: 'Sale' }, { tag: 'New' }]);
  });

  it('combines everything in a stable order', () => {
    expect(
      buildCollectionProductFilters({
        availableOnly: true,
        productType: 'snowboard',
        vendor: 'Acme',
        tags: ['Sale', 'New'],
      }),
    ).toEqual([
      { available: true },
      { productType: 'snowboard' },
      { productVendor: 'Acme' },
      { tag: 'Sale' },
      { tag: 'New' },
    ]);
  });

  it('gives several tags the ANY meaning of buildProductSearchQuery', () => {
    // Shopify ORs filters of the same type (verified live with availability:
    // [{available:true},{available:false}] returns the whole collection), so
    // these two tag filters mean Sale OR New, like the products query below.
    expect(buildCollectionProductFilters({ tags: ['Sale', 'New'] })).toEqual([
      { tag: 'Sale' },
      { tag: 'New' },
    ]);
    expect(buildProductSearchQuery({ tags: ['Sale', 'New'] })).toBe(
      '(tag:Sale OR tag:New)',
    );
  });

  it('passes values through unescaped (they are GraphQL variables)', () => {
    expect(buildCollectionProductFilters({ vendor: 'vendor:"x" (y)' })).toEqual(
      [{ productVendor: 'vendor:"x" (y)' }],
    );
  });

  it('drops filters the collection does not support', () => {
    const defaults: CollectionFilterSupport = {
      availability: true,
      productType: false,
      vendor: false,
      tag: false,
      price: true,
    };
    const input = {
      availableOnly: true,
      productType: 'snowboard',
      vendor: 'Acme',
      tags: ['Sale'],
    };
    expect(buildCollectionProductFilters(input, defaults)).toEqual([
      { available: true },
    ]);
    expect(
      buildCollectionProductFilters(input, {
        ...defaults,
        availability: false,
        vendor: true,
        tag: true,
      }),
    ).toEqual([{ productVendor: 'Acme' }, { tag: 'Sale' }]);
  });
});

describe('mergeScopeTags', () => {
  it('returns the chosen tags when the scope has none', () => {
    expect(mergeScopeTags(undefined, undefined)).toEqual([]);
    expect(mergeScopeTags([], ['Sale', ' New ', 'sale'])).toEqual([
      'Sale',
      'New',
    ]);
    expect(mergeScopeTags(['', ' '], ['Sale'])).toEqual(['Sale']);
  });

  it('returns the whole scope when nothing is chosen', () => {
    expect(mergeScopeTags(['Summer', 'Sale'], undefined)).toEqual([
      'Summer',
      'Sale',
    ]);
    expect(mergeScopeTags(['Summer', 'Sale'], [])).toEqual(['Summer', 'Sale']);
  });

  it('narrows the scope to the chosen tags, keeping scope casing', () => {
    expect(mergeScopeTags(['Summer', 'Sale', 'New'], ['sale', 'NEW'])).toEqual([
      'Sale',
      'New',
    ]);
  });

  it('never widens the scope with tags outside it', () => {
    expect(mergeScopeTags(['Summer'], ['Sale'])).toEqual(['Summer']);
    expect(mergeScopeTags(['Summer', 'Sale'], ['Sale', 'Winter'])).toEqual([
      'Sale',
    ]);
    for (const chosen of [[], ['Winter'], ['Sale', 'Winter'], ['summer']]) {
      const merged = mergeScopeTags(['Summer', 'Sale'], chosen);
      expect(merged.length).toBeGreaterThan(0);
      for (const tag of merged) expect(['Summer', 'Sale']).toContain(tag);
    }
  });
});

describe('sorting', () => {
  const ALL_SORTS = PICKER_SORT_OPTIONS.map((option) => option.value);

  it('lists every sort with a sentence-case label', () => {
    expect(PICKER_SORT_OPTIONS).toEqual([
      { value: 'relevance', label: 'Relevance' },
      { value: 'collection-default', label: 'Collection order' },
      { value: 'best-selling', label: 'Best selling' },
      { value: 'newest', label: 'Newest' },
      { value: 'updated', label: 'Recently updated' },
      { value: 'title-asc', label: 'Title A–Z' },
      { value: 'price-asc', label: 'Price low → high' },
      { value: 'price-desc', label: 'Price high → low' },
    ]);
  });

  it('applies the availability matrix', () => {
    const matrix: Record<PickerSort, [boolean, boolean, boolean, boolean]> = {
      // [all products, all products + text, collection, collection + text]
      relevance: [false, true, false, true],
      'collection-default': [false, false, true, true],
      'best-selling': [true, true, true, true],
      newest: [true, true, true, true],
      updated: [true, true, false, false],
      'title-asc': [true, true, true, true],
      'price-asc': [true, true, true, true],
      'price-desc': [true, true, true, true],
    };
    for (const sort of ALL_SORTS) {
      const actual = [
        isSortAvailable(sort, { inCollection: false, hasText: false }),
        isSortAvailable(sort, { inCollection: false, hasText: true }),
        isSortAvailable(sort, { inCollection: true, hasText: false }),
        isSortAvailable(sort, { inCollection: true, hasText: true }),
      ];
      expect(actual, sort).toEqual(matrix[sort]);
    }
  });

  it('picks a default that is always available', () => {
    expect(defaultSort({ inCollection: false, hasText: false })).toBe(
      'title-asc',
    );
    expect(defaultSort({ inCollection: false, hasText: true })).toBe(
      'relevance',
    );
    expect(defaultSort({ inCollection: true, hasText: false })).toBe(
      'collection-default',
    );
    expect(defaultSort({ inCollection: true, hasText: true })).toBe(
      'relevance',
    );
    for (const inCollection of [false, true]) {
      for (const hasText of [false, true]) {
        const context = { inCollection, hasText };
        expect(isSortAvailable(defaultSort(context), context)).toBe(true);
      }
    }
  });

  it('resolves unavailable sorts to the default', () => {
    expect(
      resolveSort('price-desc', { inCollection: true, hasText: false }),
    ).toBe('price-desc');
    expect(
      resolveSort('relevance', { inCollection: false, hasText: false }),
    ).toBe('title-asc');
    expect(resolveSort('updated', { inCollection: true, hasText: false })).toBe(
      'collection-default',
    );
    expect(
      resolveSort('collection-default', { inCollection: false, hasText: true }),
    ).toBe('relevance');
  });

  it('maps picker sorts to ProductSortKeys (directions verified live)', () => {
    expect(toProductSort('relevance', true)).toEqual({
      sortKey: 'RELEVANCE',
      reverse: false,
    });
    expect(toProductSort('best-selling', false)).toEqual({
      sortKey: 'BEST_SELLING',
      reverse: false,
    });
    expect(toProductSort('newest', false)).toEqual({
      sortKey: 'CREATED_AT',
      reverse: true,
    });
    expect(toProductSort('updated', false)).toEqual({
      sortKey: 'UPDATED_AT',
      reverse: true,
    });
    expect(toProductSort('title-asc', false)).toEqual({
      sortKey: 'TITLE',
      reverse: false,
    });
    expect(toProductSort('price-asc', true)).toEqual({
      sortKey: 'PRICE',
      reverse: false,
    });
    expect(toProductSort('price-desc', true)).toEqual({
      sortKey: 'PRICE',
      reverse: true,
    });
  });

  it('never sends RELEVANCE without text, nor collection order to products', () => {
    expect(toProductSort('relevance', false)).toEqual({
      sortKey: 'TITLE',
      reverse: false,
    });
    expect(toProductSort('collection-default', false)).toEqual({
      sortKey: 'TITLE',
      reverse: false,
    });
    expect(toProductSort('collection-default', true)).toEqual({
      sortKey: 'RELEVANCE',
      reverse: false,
    });
    for (const sort of ALL_SORTS) {
      expect(toProductSort(sort, false).sortKey).not.toBe('RELEVANCE');
    }
  });

  it('maps picker sorts to ProductCollectionSortKeys', () => {
    expect(toCollectionSort('relevance')).toEqual({
      sortKey: 'RELEVANCE',
      reverse: false,
    });
    expect(toCollectionSort('collection-default')).toEqual({
      sortKey: 'COLLECTION_DEFAULT',
      reverse: false,
    });
    expect(toCollectionSort('best-selling')).toEqual({
      sortKey: 'BEST_SELLING',
      reverse: false,
    });
    expect(toCollectionSort('newest')).toEqual({
      sortKey: 'CREATED',
      reverse: true,
    });
    expect(toCollectionSort('title-asc')).toEqual({
      sortKey: 'TITLE',
      reverse: false,
    });
    expect(toCollectionSort('price-asc')).toEqual({
      sortKey: 'PRICE',
      reverse: false,
    });
    expect(toCollectionSort('price-desc')).toEqual({
      sortKey: 'PRICE',
      reverse: true,
    });
  });

  it('falls back to collection order for "Recently updated"', () => {
    expect(toCollectionSort('updated')).toEqual({
      sortKey: 'COLLECTION_DEFAULT',
      reverse: false,
    });
  });

  it('returns fresh objects callers can mutate', () => {
    const first = toProductSort('newest', false);
    first.reverse = false;
    expect(toProductSort('newest', false).reverse).toBe(true);
    const second = toCollectionSort('newest');
    second.reverse = false;
    expect(toCollectionSort('newest').reverse).toBe(true);
  });
});
