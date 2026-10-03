import {
  type NormalizedRecordBinPayload,
  normalizeRecordBinPayload,
  type RecordBinCompatiblePayload,
} from './recordBinPayload';

// Leave room for the CMA JSON:API envelope and server-maintained metadata below
// the documented 300 KB record limit. Count the escaped request, not the field.
export const MAX_RECORD_BIN_REQUEST_BYTES = 280_000;
export const MAX_RECORD_BIN_ARCHIVE_BYTES = 1_048_576;
const ARCHIVE_TIMEOUT_MS = 30_000;

type PackedRecordBinArchive = {
  version: 1;
  format: 'gzip/base64';
  sourceItemId: string;
  environment: string;
  bytes: number;
  sha256: string;
  data: string;
};

export type PrepareRecordBinBodyInput = {
  payload: RecordBinCompatiblePayload;
  sourceItemId: string;
  environment: string;
  inlineRequestBytes: (recordBody: string) => number;
};

export type ResolveRecordBinBodyOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseRecordBody = (body: unknown): unknown =>
  typeof body === 'string' ? JSON.parse(body) : body;

const hasArchiveEnvelope = (body: unknown): body is Record<string, unknown> =>
  isRecord(body) && Object.hasOwn(body, '__record_bin_archive');

export const isPackedRecordBinBody = (recordBody: unknown): boolean => {
  try {
    return hasArchiveEnvelope(parseRecordBody(recordBody));
  } catch {
    return false;
  }
};

export const sha256 = async (text: string): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser cannot verify Record Bin archive integrity.');
  }

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
};

const abortError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new Error('Record Bin archive processing was cancelled.');

const readBoundedStream = async (
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  { signal, timeoutMs = ARCHIVE_TIMEOUT_MS }: ResolveRecordBinBodyOptions,
): Promise<Uint8Array<ArrayBuffer>> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let rejectAborted: ((error: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => {
    const error = signal
      ? abortError(signal)
      : new Error('Record Bin archive processing was cancelled.');
    rejectAborted?.(error);
    void reader.cancel(error).catch(() => undefined);
  };
  const timer = setTimeout(() => {
    const error = new Error('Record Bin archive processing timed out.');
    rejectAborted?.(error);
    void reader.cancel(error).catch(() => undefined);
  }, timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    if (signal?.aborted) {
      throw abortError(signal);
    }
    for (;;) {
      // Only one record is decoded at a time; reject before retaining excess data.
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        throw new Error(
          'Record Bin archive exceeds the safe decoded size limit.',
        );
      }
      chunks.push(chunk.value);
    }
    const result = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
};

const encodeBase64 = (bytes: Uint8Array): string => {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 8192) {
    chunks.push(
      String.fromCharCode(...Array.from(bytes.subarray(offset, offset + 8192))),
    );
  }
  return btoa(chunks.join(''));
};

const decodeBase64 = (
  data: string,
  maxBytes: number,
): Uint8Array<ArrayBuffer> => {
  if (
    data.length > Math.ceil(maxBytes / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data,
    )
  ) {
    throw new Error(
      'Record Bin archive contains invalid or oversized base64 data.',
    );
  }
  const decoded = atob(data);
  if (decoded.length > maxBytes) {
    throw new Error('Record Bin archive exceeds the safe encoded size limit.');
  }
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

const assertSource = (
  normalized: NormalizedRecordBinPayload,
  sourceItemId: string,
  environment: string,
): void => {
  if (
    !sourceItemId ||
    !environment ||
    normalized.entity.id !== sourceItemId ||
    normalized.environment !== environment
  ) {
    throw new Error(
      'Record Bin archive source record or environment does not match.',
    );
  }
};

const assertRequestFits = (requestBytes: number): boolean => {
  if (!Number.isSafeInteger(requestBytes) || requestBytes < 0) {
    throw new Error('Record Bin archive request size could not be determined.');
  }
  return requestBytes <= MAX_RECORD_BIN_REQUEST_BYTES;
};

export const prepareRecordBinBody = async ({
  payload,
  sourceItemId,
  environment,
  inlineRequestBytes,
}: PrepareRecordBinBodyInput): Promise<string> => {
  assertSource(
    normalizeRecordBinPayload(payload, environment),
    sourceItemId,
    environment,
  );
  const body = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(body);
  if (bytes.byteLength > MAX_RECORD_BIN_ARCHIVE_BYTES) {
    throw new Error('Record Bin archive exceeds the safe original size limit.');
  }
  if (assertRequestFits(inlineRequestBytes(body))) {
    return body;
  }
  if (typeof CompressionStream === 'undefined') {
    throw new Error(
      'This browser cannot compress this large Record Bin archive.',
    );
  }
  const compressed = await readBoundedStream(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
    MAX_RECORD_BIN_ARCHIVE_BYTES,
    {},
  );
  const archive: PackedRecordBinArchive = {
    version: 1,
    format: 'gzip/base64',
    sourceItemId,
    environment,
    bytes: bytes.byteLength,
    sha256: await sha256(body),
    data: encodeBase64(compressed),
  };
  const packed = JSON.stringify({ __record_bin_archive: archive });
  if (!assertRequestFits(inlineRequestBytes(packed))) {
    throw new Error(
      'Record Bin cannot safely archive this record within the CMA record size limit, even after compression.',
    );
  }
  return packed;
};

const hasValidArchiveMetadata = (
  value: Record<string, unknown>,
): value is Record<string, unknown> &
  Pick<
    PackedRecordBinArchive,
    'version' | 'format' | 'sourceItemId' | 'environment'
  > =>
  value.version === 1 &&
  value.format === 'gzip/base64' &&
  typeof value.sourceItemId === 'string' &&
  value.sourceItemId.length > 0 &&
  typeof value.environment === 'string' &&
  value.environment.length > 0;

const hasValidArchiveContent = (
  value: Record<string, unknown>,
  maxBytes: number,
): value is Record<string, unknown> &
  Pick<PackedRecordBinArchive, 'bytes' | 'sha256' | 'data'> =>
  typeof value.bytes === 'number' &&
  Number.isSafeInteger(value.bytes) &&
  value.bytes > 0 &&
  value.bytes <= maxBytes &&
  typeof value.sha256 === 'string' &&
  /^[a-f0-9]{64}$/.test(value.sha256) &&
  typeof value.data === 'string' &&
  value.data.length > 0;

const parseArchive = (
  value: unknown,
  maxBytes: number,
): PackedRecordBinArchive => {
  if (
    !isRecord(value) ||
    !hasValidArchiveMetadata(value) ||
    !hasValidArchiveContent(value, maxBytes)
  ) {
    throw new Error('Record Bin archive envelope is invalid or unsupported.');
  }
  return {
    version: 1,
    format: 'gzip/base64',
    sourceItemId: value.sourceItemId,
    environment: value.environment,
    bytes: value.bytes,
    sha256: value.sha256,
    data: value.data,
  };
};

export const resolveRecordBinBody = async (
  recordBody: unknown,
  fallbackEnvironment: string,
  options: ResolveRecordBinBodyOptions = {},
): Promise<NormalizedRecordBinPayload> => {
  const parsed = parseRecordBody(recordBody);
  if (!hasArchiveEnvelope(parsed)) {
    return normalizeRecordBinPayload(parsed, fallbackEnvironment);
  }
  const maxBytes = Math.min(
    options.maxBytes ?? MAX_RECORD_BIN_ARCHIVE_BYTES,
    MAX_RECORD_BIN_ARCHIVE_BYTES,
  );
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Record Bin archive decoded size limit is invalid.');
  }
  const archive = parseArchive(parsed.__record_bin_archive, maxBytes);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'This browser cannot read this compressed Record Bin archive.',
    );
  }
  const compressed = decodeBase64(archive.data, maxBytes);
  const bytes = await readBoundedStream(
    new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream('gzip')),
    Math.min(archive.bytes, maxBytes),
    options,
  );
  if (bytes.byteLength !== archive.bytes) {
    throw new Error('Record Bin archive byte length does not match.');
  }
  const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if ((await sha256(body)) !== archive.sha256) {
    throw new Error('Record Bin archive checksum does not match.');
  }
  const normalized = normalizeRecordBinPayload(body, archive.environment);
  assertSource(normalized, archive.sourceItemId, archive.environment);
  return normalized;
};
