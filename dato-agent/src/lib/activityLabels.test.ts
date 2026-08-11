import { describe, expect, it } from 'vitest';
import { localActivityLabel, mcpActivityLabel } from './activityLabels';

function fullScriptArguments(
  content: string,
  methodTokens: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    body: { mode: 'full', content },
    method_tokens: methodTokens,
    ...extra,
  };
}

describe('mcpActivityLabel', () => {
  it('uses concise labels for discovery operations', () => {
    expect(mcpActivityLabel('get_api_methods', {}, 'in_progress')).toBe(
      'Looking up relevant API methods',
    );
    expect(mcpActivityLabel('get_schema', {}, 'in_progress')).toBe(
      'Reading the content model',
    );
    expect(mcpActivityLabel('whoami', {}, 'completed')).toBe(
      'Checking the DatoCMS connection',
    );
  });

  it('recognizes a literal record search without displaying its query', () => {
    const argumentsValue = fullScriptArguments(
      'const records = await client.items.rawList({ filter: { query: "private launch" } });',
      ['m.items.rawList.signature'],
    );

    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        argumentsValue,
        'in_progress',
      ),
    ).toBe('Searching records');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        argumentsValue,
        'in_progress',
      ),
    ).not.toContain('private launch');
  });

  it('does not mistake an unrelated query property for a record search filter', () => {
    const argumentsValue = fullScriptArguments(
      'await client.items.rawList({ filter: { type: "article" }, query: "outside-filter" });',
      ['m.items.rawList.signature'],
    );

    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        argumentsValue,
        'in_progress',
      ),
    ).toBe('Reading records');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        fullScriptArguments(
          'await client.items.rawList(); const ui = { filter: { query: "not-a-CMA-filter" } };',
          ['m.items.rawList.signature'],
        ),
        'in_progress',
      ),
    ).toBe('Reading records');
  });

  it('recognizes conservative record, asset, and content-model reads', () => {
    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        fullScriptArguments('await client.items.find("record-id");', [
          'm.items.find.signature',
        ]),
        'in_progress',
      ),
    ).toBe('Reading records');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        fullScriptArguments('await client.uploads.rawList();', [
          'm.uploads.rawList.signature',
        ]),
        'completed',
      ),
    ).toBe('Reading assets');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        fullScriptArguments('await client.itemTypes.rawList();', [
          'm.itemTypes.rawList.signature',
        ]),
        'completed',
      ),
    ).toBe('Reading the content model');
  });

  it('requires coordinates in both source and method tokens', () => {
    const source = 'await client.items.rawList({ filter: { query: "term" } });';

    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        fullScriptArguments(source, []),
        'in_progress',
      ),
    ).toBe('Reading CMS content');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        fullScriptArguments(source, ['m.uploads.rawList.signature']),
        'in_progress',
      ),
    ).toBe('Reading CMS content');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        fullScriptArguments('console.log("client.items.rawList(");', [
          'm.items.rawList.signature',
        ]),
        'in_progress',
      ),
    ).toBe('Reading CMS content');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        fullScriptArguments('// client.items.rawList(\nconsole.log("done");', [
          'm.items.rawList.signature',
        ]),
        'in_progress',
      ),
    ).toBe('Reading CMS content');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        fullScriptArguments('const pattern = /client.items.update(foo)/;', [
          'm.items.update.signature',
        ]),
        'waiting',
      ),
    ).toBe('Preparing a CMS change');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        fullScriptArguments(
          'const pattern = /foo\\/client.items.update(foo)/;',
          ['m.items.update.signature'],
        ),
        'waiting',
      ),
    ).toBe('Preparing a CMS change');
  });

  it('falls back for mixed, unknown, patched, oversized, and malformed scripts', () => {
    const mixed = fullScriptArguments(
      'await client.items.rawList(); await client.uploads.rawList();',
      ['m.items.rawList.signature', 'm.uploads.rawList.signature'],
    );
    const unknown = fullScriptArguments('await client.items.mystery();', [
      'm.items.mystery.signature',
    ]);

    for (const parsedArguments of [
      mixed,
      unknown,
      { body: { mode: 'patch', replacements: [] }, method_tokens: [] },
      fullScriptArguments(
        `await client.items.rawList();${' '.repeat(100_000)}`,
        ['m.items.rawList.signature'],
      ),
      null,
      'unparsed arguments',
    ]) {
      expect(
        mcpActivityLabel(
          'upsert_and_execute_safe_script',
          parsedArguments,
          'in_progress',
        ),
      ).toBe('Reading CMS content');
    }
  });

  it('bounds literal call inspection for pathological generated scripts', () => {
    const repeatedCalls = Array.from(
      { length: 17 },
      () => 'await client.items.rawList();',
    ).join('\n');

    expect(
      mcpActivityLabel(
        'upsert_and_execute_safe_script',
        fullScriptArguments(repeatedCalls, ['m.items.rawList.signature']),
        'in_progress',
      ),
    ).toBe('Reading CMS content');
  });

  it('does not expose unknown tool names or arbitrary arguments', () => {
    const label = mcpActivityLabel(
      'secret_sk_project_value',
      { api_key: 'sk-private', prompt: 'show this prose' },
      'in_progress',
    );

    expect(label).toBe('Running a DatoCMS operation');
    expect(label).not.toMatch(/secret|private|prose/i);
  });

  it('uses preparation wording before dispatch and active wording afterwards', () => {
    const update = fullScriptArguments(
      'await client.items.update("record-id", { title: "New" });',
      ['m.items.update.signature'],
    );

    expect(
      mcpActivityLabel('upsert_and_execute_unsafe_script', update, 'waiting'),
    ).toBe('Preparing record updates');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        update,
        'in_progress',
      ),
    ).toBe('Updating records');
    expect(
      mcpActivityLabel('upsert_and_execute_unsafe_script', update, 'completed'),
    ).toBe('Updating records');
    expect(
      mcpActivityLabel('upsert_and_execute_unsafe_script', update, 'failed'),
    ).toBe('Updating records');
  });

  it('describes explicit bulk record methods without claiming early dispatch', () => {
    const bulkUpdate = fullScriptArguments(
      'await client.items.bulkMoveToStage({ item_ids: ["one"], stage: "review" });',
      ['m.items.bulkMoveToStage.signature'],
    );

    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        bulkUpdate,
        'waiting',
      ),
    ).toBe('Preparing bulk record processing');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        bulkUpdate,
        'in_progress',
      ),
    ).toBe('Bulk processing records');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        bulkUpdate,
        'completed',
      ),
    ).toBe('Bulk processing records');
  });

  it('ignores known reads while classifying the literal write operation', () => {
    const readThenUpdate = fullScriptArguments(
      'const item = await client.items.rawFind("one"); await client.items.update(item.id, { title: "New" });',
      ['m.items.rawFind.signature', 'm.items.update.signature'],
    );
    const readThenPublish = fullScriptArguments(
      'const item = await client.items.find("one"); if (item) await client.items.publish(item.id);',
      ['m.items.find.signature', 'm.items.publish.signature'],
    );

    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        readThenUpdate,
        'waiting',
      ),
    ).toBe('Preparing record updates');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        readThenPublish,
        'in_progress',
      ),
    ).toBe('Publishing records');
  });

  it('does not claim a write effect merely because the script completed', () => {
    const conditionalUpdate = fullScriptArguments(
      'if (false) await client.items.update("one", { title: "Never run" });',
      ['m.items.update.signature'],
    );

    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        conditionalUpdate,
        'completed',
      ),
    ).toBe('Updating records');
  });

  it('describes other literal write actions and uses generic wording for mixed writes', () => {
    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        fullScriptArguments('await client.uploads.destroy("upload-id");', [
          'm.uploads.destroy.signature',
        ]),
        'waiting',
      ),
    ).toBe('Preparing asset deletion');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        fullScriptArguments('await client.items.publish("record-id");', [
          'm.items.publish.signature',
        ]),
        'in_progress',
      ),
    ).toBe('Publishing records');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        fullScriptArguments(
          'await client.items.update("record-id", {}); await client.items.publish("record-id");',
          ['m.items.update.signature', 'm.items.publish.signature'],
        ),
        'waiting',
      ),
    ).toBe('Preparing a CMS change');
  });

  it('never implies execution when no_execute is literal true', () => {
    const stored = fullScriptArguments(
      'await client.items.update("record-id", {});',
      ['m.items.update.signature'],
      { no_execute: true },
    );

    expect(
      mcpActivityLabel('upsert_and_execute_unsafe_script', stored, 'waiting'),
    ).toBe('Saving a CMS operation');
    expect(
      mcpActivityLabel(
        'upsert_and_execute_unsafe_script',
        stored,
        'in_progress',
      ),
    ).toBe('Saving a CMS operation');
    expect(
      mcpActivityLabel('upsert_and_execute_unsafe_script', stored, 'completed'),
    ).toBe('CMS operation saved');
  });
});

describe('localActivityLabel', () => {
  it('humanizes a literal model identifier in active and completed labels', () => {
    expect(
      localActivityLabel(
        'get_model_schema',
        { identifier: 'product' },
        'in_progress',
      ),
    ).toBe('Reading Product fields');
    expect(
      localActivityLabel(
        'get_model_schema',
        { identifier: 'blog_post' },
        'completed',
      ),
    ).toBe('Blog Post fields loaded');
    expect(
      localActivityLabel(
        'get_model_schema',
        { identifier: 'seo_article' },
        'in_progress',
      ),
    ).toBe('Reading SEO Article fields');
  });

  it('uses generic model wording for malformed, credential-like, and long identifiers', () => {
    for (const identifier of [
      undefined,
      null,
      '',
      'product title',
      'Product',
      'HTC4ys4MRiG_gJcyrHMigA',
      'sk_private_key',
      'sk-private-key',
      'x'.repeat(41),
    ]) {
      expect(
        localActivityLabel('get_model_schema', { identifier }, 'in_progress'),
      ).toBe('Reading model fields');
    }
    expect(
      localActivityLabel(
        'get_model_schema',
        { identifier: 'product' },
        'failed',
      ),
    ).toBe('Could not read model fields');
  });

  it('adds only explicit array counts to existing local labels', () => {
    expect(
      localActivityLabel(
        'show_records',
        { records: [{ id: 'one' }, { id: 'two' }] },
        'in_progress',
      ),
    ).toBe('Showing 2 records');
    expect(
      localActivityLabel('present_records', { records: [{}] }, 'completed'),
    ).toBe('1 record link ready');
    expect(
      localActivityLabel(
        'present_fields',
        { fields: [{}, {}, {}] },
        'in_progress',
      ),
    ).toBe('Adding 3 field links');
    expect(
      localActivityLabel(
        'read_current_record_live_form_state',
        { fields: [{}] },
        'completed',
      ),
    ).toBe('1 current form value read');
    expect(
      localActivityLabel('present_assets', { assets: [{}, {}] }, 'in_progress'),
    ).toBe('Adding 2 asset links');
    expect(
      localActivityLabel('present_models', { models: [{}] }, 'in_progress'),
    ).toBe('Adding 1 model reference');
    expect(
      localActivityLabel('present_users', { users: [{}, {}] }, 'completed'),
    ).toBe('2 user references ready');
  });

  it('preserves generic local labels for missing or malformed arguments', () => {
    expect(localActivityLabel('show_records', null, 'in_progress')).toBe(
      'Showing records',
    );
    expect(
      localActivityLabel(
        'present_assets',
        { assets: 'not-an-array' },
        'completed',
      ),
    ).toBe('Asset links ready');
    expect(
      localActivityLabel('unknown_secret_tool', { secret: 'value' }, 'waiting'),
    ).toBe('Running a local action');
  });
});
