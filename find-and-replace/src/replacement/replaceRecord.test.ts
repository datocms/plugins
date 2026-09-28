import {
  ApiError,
  type Client,
  type RawApiTypes,
  TimeoutError,
} from '@datocms/cma-client-browser';
import { describe, expect, expectTypeOf, it, type vi } from 'vitest';
import type {
  FailDetail,
  FailReason,
  SkipReason,
} from '../findReplace/contract';
import {
  type DiscoveredTarget,
  discoverTargetsInRecord,
} from '../selection/discoverTargets';
import type { ExactMatchRef, MatcherSpec } from '../selection/types';
import {
  cloneRoot,
  findReplaceRoot,
  findReplaceSchema,
  literalMatcher,
  regexMatcher,
  replacementClient,
} from './replacementPlanner.fixtures';
import {
  compileReplacementTemplate,
  literalTemplate,
  type ReplacementTemplate,
} from './replacementTemplate';
import {
  type RecordWriteOutcome,
  replaceInRecord,
  type UnconfirmedWrite,
  type WriteSkipReason,
} from './replaceRecord';
import type { WriteFailDetail, WriteFailReason } from './writeErrors';

type Root = RawApiTypes.ItemInNestedResponse;
type UnknownRecord = Record<string, unknown>;

const globex = literalTemplate('Globex');

async function discover(
  matcher: MatcherSpec,
  root: Root = findReplaceRoot(),
): Promise<DiscoveredTarget[]> {
  return discoverTargetsInRecord({
    record: root,
    rootModelId: 'article-model',
    schema: findReplaceSchema(),
    siteId: 'site-1',
    environment: 'main',
    spec: {
      workflow: 'text',
      granularity: 'exact_match',
      rootModelIds: ['article-model'],
      locales: ['en', 'it'],
      publicationStatuses: [],
      fieldTypes: ['string', 'text', 'slug', 'structured_text', 'seo'],
      matcher,
    },
  });
}

function exact(entry: DiscoveredTarget): ExactMatchRef {
  if (entry.target.kind !== 'exact_match') {
    throw new Error('Expected an exact-match target');
  }
  return entry.target;
}

function pick(
  entries: ReadonlyArray<DiscoveredTarget>,
  predicate: (match: ExactMatchRef) => boolean,
): DiscoveredTarget {
  const found = entries.find((entry) => predicate(exact(entry)));
  if (!found) throw new Error('No discovered target matches');
  return found;
}

/** First "Acme" of the English title, and the "Ac|me" match spanning two ST spans. */
async function titleAndMultiSpan(): Promise<DiscoveredTarget[]> {
  const entries = await discover(literalMatcher('acme'));
  return [
    pick(
      entries,
      (match) =>
        match.fieldValue.fieldApiKey === 'title' &&
        match.fieldValue.locale === 'en' &&
        match.matchedText === 'Acme',
    ),
    pick(
      entries,
      (match) =>
        match.fieldValue.fieldApiKey === 'body' && match.fragments.length > 1,
    ),
  ];
}

async function firstQuoteMatch(root: Root = findReplaceRoot()) {
  return pick(
    await discover(literalMatcher('Acme', true), root),
    (match) => match.fieldValue.ownerRecordId === 'q-1',
  );
}

function compiled(text: string, matcher: MatcherSpec): ReplacementTemplate {
  const compilation = compileReplacementTemplate(text, matcher);
  if (!compilation.ok) throw new Error('Expected the template to compile');
  return compilation.template;
}

function write(
  client: Client,
  entries: ReadonlyArray<DiscoveredTarget>,
  template: ReplacementTemplate = globex,
  unconfirmed: UnconfirmedWrite | null = null,
): Promise<RecordWriteOutcome> {
  return replaceInRecord({
    client,
    schema: findReplaceSchema(),
    siteId: 'site-1',
    environment: 'main',
    locales: ['en', 'it'],
    entries,
    template,
    unconfirmed,
  });
}

function apiError(
  status: number,
  entities: Array<{
    code: string;
    details?: UnknownRecord;
    transient?: true;
  }> = [],
): ApiError {
  return new ApiError({
    request: { url: '/items/article-1', method: 'PUT', headers: {} },
    response: {
      status,
      statusText: '',
      headers: {},
      body: {
        data: entities.map((entity, index) => ({
          id: `error-${index}`,
          type: 'api_error',
          attributes: {
            code: entity.code,
            doc_url: '',
            details: entity.details ?? {},
            ...(entity.transient ? { transient: true } : {}),
          },
        })),
      },
    },
  });
}

function sentBody(update: ReturnType<typeof vi.fn>, call = 0): UnknownRecord {
  return (update.mock.calls[call]?.[1] ?? {}) as UnknownRecord;
}

function bodyParagraph(value: unknown, locale: string, index: number): unknown {
  const body = value as Record<
    string,
    { document: { children: Array<{ children?: unknown }> } }
  >;
  return body[locale]?.document.children[index]?.children;
}

/** The article as it is after "Globex" landed in the title and the first ST match. */
function landedRoot(version: string): Root {
  const root = cloneRoot(findReplaceRoot('article-1', version));
  const attributes = root.attributes as UnknownRecord;
  attributes.title = { en: 'Globex Widget by ACME', it: 'Widget Acme' };
  const body = attributes.body as Record<
    string,
    { document: { children: Array<{ children: UnknownRecord[] }> } }
  >;
  const paragraph = body.en?.document.children[0]?.children;
  if (!paragraph) throw new Error('Missing fixture paragraph');
  paragraph[0] = { type: 'span', value: 'Hello Globex' };
  paragraph[1] = {
    type: 'span',
    marks: ['strong'],
    value: ' world, acme again',
  };
  return root;
}

describe('replaceInRecord', () => {
  it('reads fresh, updates once with the fresh version, and leaves excluded matches untouched', async () => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );

    const outcome = await write(client, await titleAndMultiSpan());

    expect(outcome).toEqual({
      status: 'replaced',
      replacedMatches: 2,
      freshTitle: 'The Acme headline',
      // The fresh read's status, and the version the update answered with.
      publication: { statusBefore: 'published', versionAfter: 'version-1' },
    });
    expect(spies.rawFind).toHaveBeenCalledTimes(1);
    expect(spies.rawFind).toHaveBeenCalledWith('article-1', {
      nested: true,
      version: 'current',
    });
    expect(spies.update).toHaveBeenCalledTimes(1);
    const body = sentBody(spies.update);
    expect(body.meta).toEqual({ current_version: 'version-1' });
    expect(body.title).toEqual({
      en: 'Globex Widget by ACME',
      it: 'Widget Acme',
    });
    // The excluded "acme again" and the marks of the second span stay.
    expect(bodyParagraph(body.body, 'en', 0)).toEqual([
      { type: 'span', value: 'Hello Globex' },
      { type: 'span', marks: ['strong'], value: ' world, acme again' },
    ]);
    // Untouched blocks are sent by ID only.
    expect(
      (body.body as Record<string, { document: { children: unknown[] } }>).en
        ?.document.children[1],
    ).toEqual({ type: 'block', item: 'q-body' });
    expect(Object.keys(body).sort()).toEqual(['body', 'meta', 'title']);
    expect(spies.validateExisting).not.toHaveBeenCalled();
    expect(spies.publish).not.toHaveBeenCalled();
  });

  it('replaces when an unrelated field changed after the search, keeping that change', async () => {
    const searched = findReplaceRoot('article-1', 'version-1');
    const entry = await firstQuoteMatch(searched);
    const fresh = cloneRoot(findReplaceRoot('article-1', 'version-2'));
    const attributes = fresh.attributes as UnknownRecord;
    attributes.headline = 'Edited by someone else';
    const content = attributes.content as UnknownRecord[];
    const callout = content[1]?.attributes as UnknownRecord;
    callout.label = 'Edited callout';
    content.unshift({
      id: 'q-0',
      type: 'item',
      attributes: { text: 'A new quote' },
      relationships: {
        item_type: { data: { id: 'quote-block', type: 'item_type' } },
      },
      meta: {},
    });
    const { client, spies } = await replacementClient(
      new Map([[fresh.id, fresh]]),
    );

    const outcome = await write(client, [entry]);

    expect(outcome).toMatchObject({ status: 'replaced', replacedMatches: 1 });
    const body = sentBody(spies.update);
    expect(body).toEqual({
      content: [
        'q-0',
        { id: 'q-1', type: 'item', attributes: { text: 'First Globex quote' } },
        'c-1',
        'q-2',
        's-1',
      ],
      meta: { current_version: 'version-2' },
    });
  });

  it('skips as stale when a selected field changed, without writing', async () => {
    const entry = await firstQuoteMatch();
    const fresh = cloneRoot(findReplaceRoot('article-1', 'version-2'));
    const content = (fresh.attributes as UnknownRecord)
      .content as UnknownRecord[];
    (content[0]?.attributes as UnknownRecord).text = 'First Acme quote, edited';
    const { client, spies } = await replacementClient(
      new Map([[fresh.id, fresh]]),
    );

    await expect(write(client, [entry])).resolves.toEqual({
      status: 'skipped',
      reason: 'stale',
    });
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('skips as stale when the block holding a selected field is gone', async () => {
    const entry = await firstQuoteMatch();
    const fresh = cloneRoot(findReplaceRoot('article-1', 'version-2'));
    const attributes = fresh.attributes as UnknownRecord;
    attributes.content = (attributes.content as UnknownRecord[]).slice(1);
    const { client, spies } = await replacementClient(
      new Map([[fresh.id, fresh]]),
    );

    await expect(write(client, [entry])).resolves.toEqual({
      status: 'skipped',
      reason: 'stale',
    });
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('skips a record that was deleted since the search', async () => {
    const { client, spies } = await replacementClient(new Map());
    spies.rawFind.mockRejectedValueOnce(apiError(404));

    await expect(write(client, [await firstQuoteMatch()])).resolves.toEqual({
      status: 'skipped',
      reason: 'deleted',
    });
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('never writes when every selected match is already the replacement', async () => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );

    await expect(
      write(client, [await firstQuoteMatch()], literalTemplate('Acme')),
    ).resolves.toEqual({ status: 'skipped', reason: 'stale' });
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('reports a retried update that had landed as replaced', async () => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );
    spies.update.mockRejectedValueOnce(
      apiError(422, [{ code: 'STALE_ITEM_VERSION' }]),
    );
    spies.rawFind
      .mockResolvedValueOnce({ data: cloneRoot(root) })
      .mockResolvedValueOnce({ data: landedRoot('version-2') });

    const outcome = await write(client, await titleAndMultiSpan());

    expect(outcome).toEqual({
      status: 'replaced',
      replacedMatches: 2,
      freshTitle: 'The Acme headline',
      publication: { statusBefore: 'published', versionAfter: 'version-2' },
    });
    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.rawFind).toHaveBeenCalledTimes(2);
  });

  it('skips as stale when the refused update did not land', async () => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );
    spies.update.mockRejectedValueOnce(
      apiError(422, [{ code: 'STALE_ITEM_VERSION' }]),
    );
    spies.rawFind
      .mockResolvedValueOnce({ data: cloneRoot(root) })
      .mockResolvedValueOnce({
        data: findReplaceRoot('article-1', 'version-2'),
      });

    await expect(write(client, await titleAndMultiSpan())).resolves.toEqual({
      status: 'skipped',
      reason: 'stale',
    });
  });

  it('skips as stale when the record changed between the fresh read and the update', async () => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );
    spies.update.mockRejectedValueOnce({
      findError: (code: string) => code === 'STALE_ITEM_VERSION',
    });
    const editedMeanwhile = landedRoot('version-2');
    (editedMeanwhile.attributes as UnknownRecord).title = {
      en: 'Someone else wrote this',
      it: 'Widget Acme',
    };
    spies.rawFind
      .mockResolvedValueOnce({ data: cloneRoot(root) })
      .mockResolvedValueOnce({ data: editedMeanwhile });

    await expect(write(client, await titleAndMultiSpan())).resolves.toEqual({
      status: 'skipped',
      reason: 'stale',
    });
    expect(sentBody(spies.update).meta).toEqual({
      current_version: 'version-1',
    });
  });

  it('explains a validation failure with the field label from the schema', async () => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );
    spies.update.mockRejectedValueOnce(
      apiError(422, [
        {
          code: 'INVALID_FIELD',
          details: {
            field: 'title',
            field_id: 'title-field',
            field_label: 'Server title',
            code: 'VALIDATION_LENGTH',
          },
        },
      ]),
    );

    await expect(write(client, await titleAndMultiSpan())).resolves.toEqual({
      status: 'failed',
      reason: 'validation',
      retryable: false,
      detail: { fieldLabel: 'Title', code: 'length' },
    });
  });

  it.each([
    ['403', () => apiError(403), 'permission', false],
    ['401', () => apiError(401), 'permission', false],
    [
      'a timeout',
      () =>
        new TimeoutError({
          request: { url: '/items/article-1', method: 'PUT', headers: {} },
        }),
      'network',
      true,
    ],
    ['a 503', () => apiError(503), 'network', true],
    [
      'a fetch TypeError',
      () => new TypeError('Failed to fetch'),
      'network',
      true,
    ],
    [
      'an unexpected error',
      () => new Error('Temporarily unavailable'),
      'unknown',
      false,
    ],
  ] as const)('classifies %s on update', async (_label, makeError, reason, retryable) => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );
    spies.update.mockRejectedValueOnce(makeError());

    const outcome = await write(client, [await firstQuoteMatch()]);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason,
      retryable,
      detail: null,
    });
    // A retryable failure may have landed: the outcome keeps what was sent.
    expect(
      outcome.status === 'failed' && outcome.unconfirmed !== undefined,
    ).toBe(retryable);
    expect(spies.update).toHaveBeenCalledTimes(1);
  });

  it('reports a "Try again" whose earlier update had landed as replaced, without writing again', async () => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );
    const entries = await titleAndMultiSpan();
    // The update lands, but its answer is lost (a gateway error page).
    spies.update.mockRejectedValueOnce(apiError(502));
    const first = await write(client, entries);
    if (first.status !== 'failed' || !first.unconfirmed) {
      throw new Error('Expected an unconfirmed failure');
    }
    expect(first.unconfirmed.replacedMatches).toBe(2);

    spies.update.mockClear();
    spies.rawFind.mockResolvedValueOnce({ data: landedRoot('version-2') });
    await expect(
      write(client, entries, globex, first.unconfirmed),
    ).resolves.toEqual({
      status: 'replaced',
      replacedMatches: 2,
      freshTitle: 'The Acme headline',
      // The status is the one the first attempt read before writing.
      publication: { statusBefore: 'published', versionAfter: 'version-2' },
    });
    expect(spies.update).not.toHaveBeenCalled();

    // It had not landed: the retry writes as usual.
    await expect(
      write(client, entries, globex, first.unconfirmed),
    ).resolves.toMatchObject({ status: 'replaced', replacedMatches: 2 });
    expect(spies.update).toHaveBeenCalledTimes(1);
  });

  it('classifies a failed fresh read without writing', async () => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );
    spies.rawFind.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(write(client, [await firstQuoteMatch()])).resolves.toEqual({
      status: 'failed',
      reason: 'network',
      retryable: true,
      detail: null,
    });
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('skips a record deleted between the fresh read and the update', async () => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );
    spies.update.mockRejectedValueOnce(apiError(404));

    await expect(write(client, [await firstQuoteMatch()])).resolves.toEqual({
      status: 'skipped',
      reason: 'deleted',
    });
  });

  it('writes a regex template expanded with each match captures', async () => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );
    const matcher = regexMatcher('Acme (\\w+)', true);
    const entry = pick(
      await discover(matcher),
      (match) => match.fieldValue.fieldApiKey === 'title',
    );

    await expect(
      write(client, [entry], compiled('$1 Co', matcher)),
    ).resolves.toMatchObject({ status: 'replaced', replacedMatches: 1 });
    expect(sentBody(spies.update).title).toEqual({
      en: 'Widget Co by ACME',
      it: 'Widget Acme',
    });
  });

  it('leaves targets that would need matching again to other tools', async () => {
    const root = findReplaceRoot();
    const { client, spies } = await replacementClient(
      new Map([[root.id, root]]),
    );
    const fieldValueTarget: DiscoveredTarget = {
      ...(await firstQuoteMatch()),
      target: exact(await firstQuoteMatch()).fieldValue,
      matcher: literalMatcher('Acme'),
    };

    await expect(write(client, [fieldValueTarget])).resolves.toEqual({
      status: 'skipped',
      reason: 'unsupported',
    });
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('speaks the page contract vocabulary', () => {
    expectTypeOf<WriteSkipReason>().toEqualTypeOf<SkipReason>();
    expectTypeOf<WriteFailReason>().toEqualTypeOf<FailReason>();
    expectTypeOf<WriteFailDetail>().toEqualTypeOf<FailDetail>();
  });
});
