import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRecordBinCompatiblePayload } from './recordBinPayload';
import {
  isPackedRecordBinBody,
  MAX_RECORD_BIN_ARCHIVE_BYTES,
  MAX_RECORD_BIN_REQUEST_BYTES,
  prepareRecordBinBody,
  resolveRecordBinBody,
  sha256,
} from './recordBinStorage';

const entity = {
  type: 'item',
  id: 'source-item',
  attributes: { title: 'Hello', nested: { locales: ['en', 'pt'] } },
  relationships: { item_type: { data: { type: 'item_type', id: 'model' } } },
};

const payloadWithText = (text: string) =>
  buildRecordBinCompatiblePayload({
    environment: 'sandbox',
    capturedAt: '2026-01-01T00:00:00.000Z',
    entity: { ...entity, attributes: { ...entity.attributes, text } },
  });

const requestBytes = (recordBody: string): number =>
  new TextEncoder().encode(
    JSON.stringify({
      data: {
        type: 'item',
        attributes: {
          record_body: recordBody,
          label: 'Record',
          model: 'model',
        },
        relationships: {
          item_type: { data: { type: 'item_type', id: 'record-bin-model' } },
        },
      },
    }),
  ).byteLength;

const prepare = (text: string, inlineRequestBytes = requestBytes) =>
  prepareRecordBinBody({
    payload: payloadWithText(text),
    sourceItemId: entity.id,
    environment: 'sandbox',
    inlineRequestBytes,
  });

// The callback may distinguish the wrapper so a small fixture can exercise
// compression without allocating hundreds of thousands of synthetic records.
const forcePacking = (body: string): number =>
  isPackedRecordBinBody(body) ? 1000 : MAX_RECORD_BIN_REQUEST_BYTES + 1;

const makePacked = async () => JSON.parse(await prepare('Hello', forcePacking));

const packBytes = async (bytes: Uint8Array<ArrayBuffer>) => ({
  __record_bin_archive: {
    version: 1,
    format: 'gzip/base64',
    sourceItemId: entity.id,
    environment: 'sandbox',
    bytes: bytes.byteLength,
    sha256: await sha256(new TextDecoder().decode(bytes)),
    data: btoa(
      String.fromCharCode(
        ...Array.from(
          new Uint8Array(
            await new Response(
              new Blob([bytes])
                .stream()
                .pipeThrough(new CompressionStream('gzip')),
            ).arrayBuffer(),
          ),
        ),
      ),
    ),
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('prepareRecordBinBody', () => {
  it('preserves small webhook-compatible JSON unchanged', async () => {
    const payload = payloadWithText('Small record');
    const result = await prepareRecordBinBody({
      payload,
      sourceItemId: entity.id,
      environment: 'sandbox',
      inlineRequestBytes: requestBytes,
    });
    expect(result).toBe(JSON.stringify(payload));
    expect(isPackedRecordBinBody(result)).toBe(false);
    expect(await resolveRecordBinBody(result, 'main')).toEqual({
      entity: payload.entity,
      environment: 'sandbox',
      eventType: 'to_be_restored',
    });
  });

  it('accepts the exact conservative request boundary', async () => {
    expect(await prepare('Hello', () => MAX_RECORD_BIN_REQUEST_BYTES)).toBe(
      JSON.stringify(payloadWithText('Hello')),
    );
  });

  it('counts UTF-8 bytes and escaped request content before choosing compression', async () => {
    const text = '"\\\n😊'.repeat(25_000);
    const raw = JSON.stringify(payloadWithText(text));
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(
      MAX_RECORD_BIN_REQUEST_BYTES,
    );
    expect(requestBytes(raw)).toBeGreaterThan(MAX_RECORD_BIN_REQUEST_BYTES);
    const body = await prepare(text);
    expect(isPackedRecordBinBody(body)).toBe(true);
    expect(requestBytes(body)).toBeLessThan(MAX_RECORD_BIN_REQUEST_BYTES);
    expect((await resolveRecordBinBody(body, 'main')).entity).toEqual(
      payloadWithText(text).entity,
    );
  });

  it('retains deeply nested blocks, locale maps, references and upload metadata', async () => {
    const payload = buildRecordBinCompatiblePayload({
      environment: 'sandbox',
      entity: {
        ...entity,
        attributes: {
          title: { en: 'Title', pt: 'Título' },
          hero: {
            upload_id: 'upload',
            alt: 'á',
            custom_data: { preserve: true },
          },
          content: {
            schema: 'dast',
            document: {
              type: 'root',
              children: [
                { type: 'itemLink', item: 'linked-record', children: [] },
              ],
            },
            blocks: [
              { ...entity, id: 'nested-block', attributes: { block: entity } },
            ],
          },
        },
      },
    });
    const body = await prepareRecordBinBody({
      payload,
      sourceItemId: entity.id,
      environment: 'sandbox',
      inlineRequestBytes: forcePacking,
    });
    expect((await resolveRecordBinBody(body, 'main')).entity).toEqual(
      payload.entity,
    );
  });

  it('fails before storage if even packed content cannot fit', async () => {
    await expect(
      prepare('Hello', () => MAX_RECORD_BIN_REQUEST_BYTES + 1),
    ).rejects.toThrow(/even after compression/);
  });

  it('rejects a realistic poorly compressible record near the CMA size limit', async () => {
    let state = 123456789;
    const characters: string[] = [];
    for (let index = 0; index < 295_000; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      characters.push(String.fromCharCode(32 + ((state >>> 0) % 95)));
    }
    await expect(prepare(characters.join(''))).rejects.toThrow(
      /even after compression/,
    );
  });

  it('rejects unexpectedly large originals and invalid request measurements', async () => {
    await expect(
      prepare('x'.repeat(MAX_RECORD_BIN_ARCHIVE_BYTES)),
    ).rejects.toThrow(/original size limit/);
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      await expect(prepare('Hello', () => invalid)).rejects.toThrow(
        /size could not be determined/,
      );
    }
  });

  it('requires the expected source and environment', async () => {
    await expect(
      prepareRecordBinBody({
        payload: payloadWithText('Hello'),
        sourceItemId: 'different',
        environment: 'sandbox',
        inlineRequestBytes: requestBytes,
      }),
    ).rejects.toThrow(/does not match/);
    await expect(
      prepareRecordBinBody({
        payload: payloadWithText('Hello'),
        sourceItemId: entity.id,
        environment: 'main',
        inlineRequestBytes: requestBytes,
      }),
    ).rejects.toThrow(/does not match/);
  });

  it('keeps small records usable in browsers without compression', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    expect(isPackedRecordBinBody(await prepare('Small'))).toBe(false);
    await expect(prepare('Hello', forcePacking)).rejects.toThrow(
      /cannot compress/,
    );
  });
});

describe('resolveRecordBinBody', () => {
  it('reads raw entities and legacy webhook payloads', async () => {
    expect(await resolveRecordBinBody(entity, 'main')).toEqual({
      entity,
      environment: 'main',
    });
    expect(
      await resolveRecordBinBody(
        JSON.stringify({
          entity,
          environment: 'sandbox',
          event_type: 'delete',
        }),
        'main',
      ),
    ).toEqual({ entity, environment: 'sandbox', eventType: 'delete' });
    expect(isPackedRecordBinBody('not-json')).toBe(false);
  });

  it('verifies the checksum, byte length, source and environment', async () => {
    const fixture = await makePacked();
    expect(fixture.__record_bin_archive).toMatchObject({
      version: 1,
      format: 'gzip/base64',
      sourceItemId: entity.id,
      environment: 'sandbox',
      bytes: new TextEncoder().encode(JSON.stringify(payloadWithText('Hello')))
        .byteLength,
      sha256: await sha256(JSON.stringify(payloadWithText('Hello'))),
    });
    for (const [key, value, error] of [
      ['sha256', '0'.repeat(64), /checksum/],
      ['bytes', fixture.__record_bin_archive.bytes + 1, /byte length/],
      ['sourceItemId', 'different', /source record/],
      ['environment', 'main', /environment/],
    ] as const) {
      await expect(
        resolveRecordBinBody(
          {
            __record_bin_archive: {
              ...fixture.__record_bin_archive,
              [key]: value,
            },
          },
          'main',
        ),
      ).rejects.toThrow(error);
    }
  });

  it('rejects malformed and unsupported envelopes', async () => {
    const fixture = await makePacked();
    for (const patch of [
      { version: 2 },
      { format: 'zip' },
      { bytes: 0 },
      { bytes: -1 },
      { bytes: 1.5 },
      { bytes: MAX_RECORD_BIN_ARCHIVE_BYTES + 1 },
      { sha256: 'broken' },
      { sourceItemId: '' },
      { environment: '' },
      { data: '' },
    ]) {
      await expect(
        resolveRecordBinBody(
          {
            __record_bin_archive: { ...fixture.__record_bin_archive, ...patch },
          },
          'main',
        ),
      ).rejects.toThrow(/envelope is invalid/);
    }
    expect(isPackedRecordBinBody({ __record_bin_archive: null })).toBe(true);
    await expect(
      resolveRecordBinBody({ __record_bin_archive: null }, 'main'),
    ).rejects.toThrow(/envelope is invalid/);
  });

  it('limits encoded and decoded bytes and does not accept a larger configurable maximum', async () => {
    const fixture = await makePacked();
    for (const data of ['bad!', 'A'.repeat(MAX_RECORD_BIN_ARCHIVE_BYTES * 2)]) {
      await expect(
        resolveRecordBinBody(
          { __record_bin_archive: { ...fixture.__record_bin_archive, data } },
          'main',
        ),
      ).rejects.toThrow(/base64/);
    }
    await expect(
      resolveRecordBinBody(fixture, 'main', { maxBytes: 1 }),
    ).rejects.toThrow(/envelope is invalid/);
    await expect(
      resolveRecordBinBody(
        { __record_bin_archive: { ...fixture.__record_bin_archive, bytes: 1 } },
        'main',
      ),
    ).rejects.toThrow(/decoded size limit/);
    await expect(
      resolveRecordBinBody(
        {
          __record_bin_archive: {
            ...fixture.__record_bin_archive,
            bytes: MAX_RECORD_BIN_ARCHIVE_BYTES + 1,
          },
        },
        'main',
        { maxBytes: MAX_RECORD_BIN_ARCHIVE_BYTES * 2 },
      ),
    ).rejects.toThrow(/envelope is invalid/);
  });

  it('rejects corrupt gzip and missing decompression support', async () => {
    const fixture = await makePacked();
    await expect(
      resolveRecordBinBody(
        {
          __record_bin_archive: {
            ...fixture.__record_bin_archive,
            data: 'SGVsbG8=',
          },
        },
        'main',
      ),
    ).rejects.toThrow();
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(resolveRecordBinBody(fixture, 'main')).rejects.toThrow(
      /cannot read/,
    );
  });

  it('rejects invalid UTF-8 and non-JSON decoded payloads after gzip succeeds', async () => {
    await expect(
      resolveRecordBinBody(
        await packBytes(new Uint8Array([0xc3, 0x28])),
        'main',
      ),
    ).rejects.toThrow();
    await expect(
      resolveRecordBinBody(
        await packBytes(new TextEncoder().encode('not-json')),
        'main',
      ),
    ).rejects.toThrow();
    await expect(
      resolveRecordBinBody(
        await packBytes(new TextEncoder().encode('{}')),
        'main',
      ),
    ).rejects.toThrow(/entity payload/);
  });

  it('cancels decoding before processing an already aborted request', async () => {
    const fixture = await makePacked();
    const controller = new AbortController();
    controller.abort(new Error('User cancelled'));
    await expect(
      resolveRecordBinBody(fixture, 'main', { signal: controller.signal }),
    ).rejects.toThrow('User cancelled');
  });

  it('aborts a stalled decompression stream on timeout', async () => {
    const fixture = await makePacked();
    const cancel = vi.fn();
    vi.stubGlobal(
      'DecompressionStream',
      class {
        readonly readable = new ReadableStream<Uint8Array>({ cancel });
        readonly writable = new WritableStream<Uint8Array>();
      },
    );
    vi.useFakeTimers();
    const result = resolveRecordBinBody(fixture, 'main', { timeoutMs: 20 });
    const assertion = expect(result).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
    expect(cancel).toHaveBeenCalled();
  });

  it('cancels a running stalled decoder without requiring a manual continuation', async () => {
    const fixture = await makePacked();
    const cancel = vi.fn();
    vi.stubGlobal(
      'DecompressionStream',
      class {
        readonly readable = new ReadableStream<Uint8Array>({ cancel });
        readonly writable = new WritableStream<Uint8Array>();
      },
    );
    const controller = new AbortController();
    const result = resolveRecordBinBody(fixture, 'main', {
      signal: controller.signal,
    });
    const assertion = expect(result).rejects.toThrow(
      'Cancelled during decoding',
    );
    controller.abort(new Error('Cancelled during decoding'));
    await assertion;
    expect(cancel).toHaveBeenCalled();
  });

  it('provides the standard SHA-256 digest for stable identity inputs', async () => {
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('does not skip integrity checking if Web Crypto is unavailable', async () => {
    const fixture = await makePacked();
    vi.stubGlobal('crypto', undefined);
    await expect(resolveRecordBinBody(fixture, 'main')).rejects.toThrow(
      /cannot verify/,
    );
    expect((await resolveRecordBinBody(entity, 'main')).entity).toEqual(entity);
  });
});
