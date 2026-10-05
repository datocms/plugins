import type {
  ExecuteFieldDropdownActionCtx,
  FieldDropdownActionsCtx,
  FileFieldValue,
} from 'datocms-plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireFieldGenerationLock,
  getLatestFieldContext,
  observeFieldContext,
  recordFieldValueWrite,
} from './fieldContext';

const releases: Array<() => void> = [];

function asset(id: string, alt: string | null = null): FileFieldValue {
  return {
    upload_id: id,
    alt,
    title: null,
    custom_data: {},
    focal_point: null,
  };
}

function context(
  formValues: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): ExecuteFieldDropdownActionCtx {
  return {
    site: { id: 'site-one' },
    environment: 'sandbox',
    itemType: { id: 'model-one' },
    item: { id: 'record-one' },
    formValues,
    locale: 'en',
    fieldPath: 'image',
    setFieldValue: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ExecuteFieldDropdownActionCtx;
}

function acquire(ctx: ExecuteFieldDropdownActionCtx): () => void {
  const release = acquireFieldGenerationLock(ctx);
  if (!release) {
    throw new Error('Could not acquire test field lock.');
  }
  releases.push(release);
  return release;
}

function observe(ctx: ExecuteFieldDropdownActionCtx): void {
  observeFieldContext(ctx as unknown as FieldDropdownActionsCtx);
}

afterEach(() => {
  for (const release of releases.splice(0)) {
    release();
  }
});

describe('field generation contexts', () => {
  it('uses updated form snapshots while keeping the execute-hook methods', () => {
    const original = context({ image: asset('one'), title: 'Original' });
    acquire(original);
    const updated = context({
      image: { ...asset('one'), title: 'Latest image title' },
      title: 'Latest record title',
    });
    observe(updated);

    const latest = getLatestFieldContext(original);
    expect(latest?.formValues).toBe(updated.formValues);
    expect(latest?.setFieldValue).toBe(original.setFieldValue);
    expect(latest?.fieldPath).toBe('image');
  });

  it('observes updates from another field and preserves other locales', () => {
    const original = context(
      { image: { en: asset('one'), it: asset('two') }, title: 'Original' },
      { fieldPath: 'image.en' },
    );
    acquire(original);
    const updated = context(
      {
        image: { en: asset('one'), it: asset('two', 'Italian alt') },
        title: 'Latest',
      },
      { fieldPath: 'title' },
    );
    observe(updated);

    expect(getLatestFieldContext(original)?.formValues).toBe(
      updated.formValues,
    );
  });

  it('invalidates a reordered nested block without using the old field path', () => {
    const first = { itemId: 'first', itemTypeId: 'block', image: asset('one') };
    const second = {
      itemId: 'second',
      itemTypeId: 'block',
      image: asset('two'),
    };
    const original = context(
      { blocks: [first, second] },
      { fieldPath: 'blocks.0.image' },
    );
    acquire(original);
    observe(context({ blocks: [second, first] }));

    expect(getLatestFieldContext(original)).toBeUndefined();
    observe(context({ blocks: [first, second] }));
    expect(getLatestFieldContext(original)).toBeUndefined();
  });

  it('invalidates any replaced ancestor in deeply nested blocks', () => {
    const original = context(
      {
        blocks: [
          {
            itemId: 'outer',
            itemTypeId: 'outer-model',
            nested: {
              itemId: 'inner',
              itemTypeId: 'inner-model',
              image: asset('one'),
            },
          },
        ],
      },
      { fieldPath: 'blocks[0].nested.image' },
    );
    acquire(original);
    observe(
      context({
        blocks: [
          {
            itemId: 'outer',
            itemTypeId: 'outer-model',
            nested: {
              itemId: 'replacement',
              itemTypeId: 'inner-model',
              image: asset('one'),
            },
          },
        ],
      }),
    );

    expect(getLatestFieldContext(original)).toBeUndefined();
  });

  it('checks temporary Slate block keys before writing nested images', () => {
    const original = context(
      {
        body: [
          {
            type: 'block',
            key: 'temporary-one',
            blockModelId: 'block',
            image: asset('one'),
          },
        ],
      },
      { fieldPath: 'body.0.image' },
    );
    acquire(original);
    observe(
      context({
        body: [
          {
            type: 'block',
            key: 'temporary-two',
            blockModelId: 'block',
            image: asset('one'),
          },
        ],
      }),
    );

    expect(getLatestFieldContext(original)).toBeUndefined();
  });

  it('compares unidentified blocks conservatively without treating own image writes as replacement', () => {
    const original = context(
      {
        blocks: [{ itemTypeId: 'block', title: 'First', image: asset('one') }],
      },
      { fieldPath: 'blocks.0.image' },
    );
    acquire(original);
    const latest = getLatestFieldContext(original);
    if (!latest) {
      throw new Error('Initial block context is missing.');
    }
    recordFieldValueWrite(latest, asset('one', 'Generated'));
    expect(getLatestFieldContext(original)?.formValues.blocks).toEqual([
      { itemTypeId: 'block', title: 'First', image: asset('one', 'Generated') },
    ]);
    observe(
      context({
        blocks: [
          { itemTypeId: 'block', title: 'Replacement', image: asset('one') },
        ],
      }),
    );
    expect(getLatestFieldContext(original)).toBeUndefined();
  });

  it('records a successful write while preserving a newer unrelated field snapshot', () => {
    const original = context({ image: asset('one'), title: 'Original' });
    acquire(original);
    const beforeWrite = getLatestFieldContext(original);
    if (!beforeWrite) {
      throw new Error('Initial field context is missing.');
    }
    observe(context({ image: asset('one'), title: 'Changed during await' }));
    recordFieldValueWrite(beforeWrite, asset('one', 'Generated'));

    expect(getLatestFieldContext(original)?.formValues).toEqual({
      image: asset('one', 'Generated'),
      title: 'Changed during await',
    });
    expect(original.formValues).toEqual({
      image: asset('one'),
      title: 'Original',
    });
  });

  it('preserves a field changed by the editor while a write was awaiting completion', () => {
    const original = context({ image: asset('one') });
    acquire(original);
    const beforeWrite = getLatestFieldContext(original);
    if (!beforeWrite) {
      throw new Error('Initial field context is missing.');
    }
    observe(context({ image: asset('one', 'Newer editor alt') }));
    recordFieldValueWrite(beforeWrite, asset('one', 'Generated'));

    expect(getLatestFieldContext(original)?.formValues.image).toEqual(
      asset('one', 'Newer editor alt'),
    );
  });

  it('rejects reentrancy per field but allows distinct records, fields and locales', () => {
    acquire(context({ image: asset('one') }, { fieldPath: 'image.en' }));
    expect(
      acquireFieldGenerationLock(
        context({ image: asset('one') }, { fieldPath: 'image.en' }),
      ),
    ).toBeUndefined();
    acquire(
      context({ image: asset('one') }, { fieldPath: 'image.it', locale: 'it' }),
    );
    acquire(context({ other: asset('two') }, { fieldPath: 'other' }));
    acquire(context({ image: asset('one') }, { item: { id: 'another' } }));
    acquire(context({ image: asset('one') }, { environment: 'another' }));
    acquire(context({ image: asset('one') }, { site: { id: 'another' } }));
  });

  it('shares a non-localized field lock across active locale tabs', () => {
    acquire(context({ image: asset('one') }));
    expect(
      acquireFieldGenerationLock(
        context({ image: asset('one') }, { locale: 'it' }),
      ),
    ).toBeUndefined();
  });

  it('uses conservative draft locks and stops when a draft snapshot is ambiguous', () => {
    const draft = context({ image: asset('one') }, { item: null });
    acquire(draft);
    expect(
      acquireFieldGenerationLock(
        context({ image: asset('two') }, { item: null }),
      ),
    ).toBeUndefined();
    observe(context({ image: asset('two') }, { item: null }));

    expect(getLatestFieldContext(draft)).toBeUndefined();
  });

  it('accepts successful own writes in drafts without requiring a host snapshot echo', () => {
    const draft = context({ image: asset('one') }, { item: null });
    acquire(draft);
    const latest = getLatestFieldContext(draft);
    if (!latest) {
      throw new Error('Initial draft context is missing.');
    }
    recordFieldValueWrite(latest, asset('one', 'Generated'));

    expect(getLatestFieldContext(draft)?.formValues.image).toEqual(
      asset('one', 'Generated'),
    );
  });

  it('releases locks without allowing late callbacks to reuse a stale context', () => {
    const original = context({ image: asset('one') });
    const release = acquire(original);
    release();

    expect(getLatestFieldContext(original)).toBeUndefined();
    acquire(context({ image: asset('one') }));
  });
});
