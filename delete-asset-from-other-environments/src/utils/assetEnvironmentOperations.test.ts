import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAssetEnvironmentOperations,
  type Environment,
  type Progress,
  runEnvironmentTasks,
} from './assetEnvironmentOperations';

const BASE_URL = 'https://cma.example.test/api/';
const UPLOAD_ID = 'upload-00009999';
const CURRENT_ENV = 'current-environment';

function environment(id: string): Environment {
  return {
    id,
    type: 'environment',
    meta: {
      status: 'ready',
      read_only_mode: false,
      created_at: '2026-01-01T00:00:00.000Z',
      last_data_change_at: '2026-01-01T00:00:00.000Z',
      primary: id === CURRENT_ENV,
      forked_from: null,
    },
  };
}

// Counts represent the project, without allocating or scanning its entities.
const massiveProject = {
  assetCount: 10_000,
  recordCount: 200_000,
  modelCount: 2_000,
  localeCount: 40,
  environments: Array.from({ length: 1_200 }, (_, index) =>
    environment(`environment-${index}`),
  ),
};

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function uploadResponse() {
  return jsonResponse({ data: { id: UPLOAD_ID, type: 'upload' } });
}

function errorResponse(
  status: number,
  code: string,
  options: { transient?: boolean; headers?: HeadersInit } = {},
) {
  return jsonResponse(
    {
      data: [
        {
          id: 'synthetic-error',
          type: 'api_error',
          attributes: {
            code,
            doc_url: 'https://example.test/errors',
            details: {},
            ...(options.transient ? { transient: true } : {}),
          },
        },
      ],
    },
    status,
    options.headers,
  );
}

type CapturedRequest = {
  url: string;
  method: string;
  headers: Headers;
  environment: string | null;
  signal: AbortSignal | null;
  startedAt: number;
};

function session(
  handler: (request: CapturedRequest) => Response | Promise<Response>,
) {
  const controller = new AbortController();
  const requests: CapturedRequest[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const headers = new Headers(init?.headers);
    const request: CapturedRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? 'GET',
      headers,
      environment: headers.get('x-environment'),
      signal: init?.signal ?? null,
      startedAt: Date.now(),
    };
    requests.push(request);
    return handler(request);
  });
  const operations = createAssetEnvironmentOperations({
    apiToken: 'synthetic-token',
    baseUrl: BASE_URL,
    signal: controller.signal,
    fetchFn,
  });
  return { controller, fetchFn, requests, operations };
}

async function finish<T>(operation: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return operation;
}

function assertCompleteProgress(progress: Progress[], total: number) {
  expect(progress).toEqual(
    Array.from({ length: total + 1 }, (_, completed) => ({ completed, total })),
  );
}

function neverCompletesUntilAborted(request: CapturedRequest) {
  return new Promise<Response>((_resolve, reject) => {
    request.signal?.addEventListener(
      'abort',
      () => reject(new DOMException('Synthetic HTTP aborted', 'AbortError')),
      { once: true },
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('bounded environment workers', () => {
  it('processes 1,200 environments incrementally with at most four tasks and exact progress', async () => {
    let active = 0;
    let peakActive = 0;
    let started = 0;
    const progress: Progress[] = [];
    const task = vi.fn(async (env: Environment) => {
      started += 1;
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      active -= 1;
      if (env.id === 'environment-37') throw new Error('Synthetic failure');
      return env.id;
    });

    const operation = runEnvironmentTasks(
      massiveProject.environments,
      new AbortController().signal,
      task,
      (value) => progress.push(value),
    );

    expect(started).toBe(4);
    expect(progress).toEqual([{ completed: 0, total: 1_200 }]);
    const result = await finish(operation);
    expect(peakActive).toBe(4);
    expect(active).toBe(0);
    expect(task).toHaveBeenCalledTimes(1_200);
    expect(result.results).toHaveLength(1_199);
    expect(result.failures).toEqual([
      {
        envId: 'environment-37',
        message:
          'Could not complete the request. Check your connection and access permissions.',
      },
    ]);
    assertCompleteProgress(progress, 1_200);
  });

  it('reports zero work without creating any workers', async () => {
    const task = vi.fn(async () => 'unused');
    const progress: Progress[] = [];
    expect(
      await runEnvironmentTasks(
        [],
        new AbortController().signal,
        task,
        (value) => progress.push(value),
      ),
    ).toEqual({ results: [], failures: [] });
    expect(task).not.toHaveBeenCalled();
    expect(progress).toEqual([{ completed: 0, total: 0 }]);
  });

  it('does not start queued tasks or publish completion after cancellation', async () => {
    const controller = new AbortController();
    const releases: Array<() => void> = [];
    const progress: Progress[] = [];
    const task = vi.fn(
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );
    const operation = runEnvironmentTasks(
      massiveProject.environments,
      controller.signal,
      task,
      (value) => progress.push(value),
    );
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(task).toHaveBeenCalledTimes(4);
    controller.abort();
    for (const release of releases) release();
    await rejection;
    expect(task).toHaveBeenCalledTimes(4);
    expect(progress).toEqual([{ completed: 0, total: 1_200 }]);
  });

  it('preserves completed progress when canceled after work has already succeeded', async () => {
    const controller = new AbortController();
    const releases: Array<() => void> = [];
    const progress: Progress[] = [];
    const task = vi.fn(
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );
    const operation = runEnvironmentTasks(
      massiveProject.environments,
      controller.signal,
      task,
      (value) => progress.push(value),
    );
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
    });
    releases[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(5);
    expect(progress).toEqual([
      { completed: 0, total: 1_200 },
      { completed: 1, total: 1_200 },
    ]);
    controller.abort();
    for (const release of releases.slice(1)) release();
    await rejection;
    expect(task).toHaveBeenCalledTimes(5);
    expect(progress).toEqual([
      { completed: 0, total: 1_200 },
      { completed: 1, total: 1_200 },
    ]);
  });
});

describe('environment discovery and single-asset lookup', () => {
  it('gets the complete environment endpoint once with the configured base URL', async () => {
    const { operations, requests } = session(() =>
      jsonResponse({ data: massiveProject.environments }),
    );
    expect(await finish(operations.listEnvironments())).toEqual(
      massiveProject.environments,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `${BASE_URL}environments`,
      method: 'GET',
      environment: null,
    });
    expect(requests[0].headers.get('authorization')).toBe(
      'Bearer synthetic-token',
    );
  });

  it('looks up only the selected ID for 1,200 environments in a massive project', async () => {
    let active = 0;
    let peakActive = 0;
    const { operations, requests } = session(async (request) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      active -= 1;
      const index = Number(request.environment?.replace('environment-', ''));
      return index % 2 === 0
        ? uploadResponse()
        : errorResponse(404, 'NOT_FOUND');
    });
    const progress: Progress[] = [];
    const input = [
      environment(CURRENT_ENV),
      ...massiveProject.environments,
      ...massiveProject.environments.slice(0, 10),
      environment(CURRENT_ENV),
    ];

    const result = await finish(
      operations.checkEnvironments(input, UPLOAD_ID, CURRENT_ENV, (value) =>
        progress.push(value),
      ),
    );

    expect(massiveProject).toMatchObject({
      assetCount: 10_000,
      recordCount: 200_000,
    });
    expect(result.matches).toHaveLength(600);
    expect(result.failures).toEqual([]);
    expect(requests).toHaveLength(1_200);
    expect(new Set(requests.map((request) => request.environment)).size).toBe(
      1_200,
    );
    expect(peakActive).toBeLessThanOrEqual(4);
    for (const request of requests) {
      expect(request.url).toBe(`${BASE_URL}uploads/${UPLOAD_ID}`);
      expect(request.method).toBe('GET');
      expect(request.environment).not.toBe(CURRENT_ENV);
    }
    for (let index = 1; index < requests.length; index += 1) {
      expect(
        requests[index].startedAt - requests[index - 1].startedAt,
      ).toBeGreaterThanOrEqual(250);
    }
    assertCompleteProgress(progress, 1_200);
  });

  it('distinguishes an absent asset from inaccessible or invalid environments', async () => {
    const responses: Record<string, () => Response> = {
      present: uploadResponse,
      missing: () => errorResponse(404, 'NOT_FOUND'),
      invalid: () => errorResponse(404, 'INVALID_ENVIRONMENT'),
      forbidden: () => errorResponse(403, 'INSUFFICIENT_PERMISSIONS'),
      unknown: () => jsonResponse({}, 404),
      mixed: () =>
        jsonResponse(
          {
            data: [
              {
                id: 'one',
                type: 'api_error',
                attributes: { code: 'NOT_FOUND' },
              },
              {
                id: 'two',
                type: 'api_error',
                attributes: { code: 'INVALID_ENVIRONMENT' },
              },
            ],
          },
          404,
        ),
    };
    const { operations, requests } = session((request) =>
      responses[request.environment ?? 'unknown'](),
    );
    const result = await finish(
      operations.checkEnvironments(
        Object.keys(responses).map(environment),
        UPLOAD_ID,
        CURRENT_ENV,
      ),
    );

    expect(result.matches.map((env) => env.id)).toEqual(['present']);
    expect(result.failures.map((failure) => failure.envId).sort()).toEqual([
      'forbidden',
      'invalid',
      'mixed',
      'unknown',
    ]);
    expect(requests).toHaveLength(6);
  });

  it.each(['check', 'delete'] as const)(
    'does no HTTP work when %s has no other environments',
    async (kind) => {
      const { operations, fetchFn } = session(uploadResponse);
      const progress: Progress[] = [];
      const input = [environment(CURRENT_ENV), environment(CURRENT_ENV)];
      const result = await (kind === 'check'
        ? operations.checkEnvironments(input, UPLOAD_ID, CURRENT_ENV, (value) =>
            progress.push(value),
          )
        : operations.deleteCopies(input, UPLOAD_ID, CURRENT_ENV, (value) =>
            progress.push(value),
          ));
      expect(result.failures).toEqual([]);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(progress).toEqual([{ completed: 0, total: 0 }]);
    },
  );
});

describe('automatic bounded retries and shared rate-limit cooldown', () => {
  it.each([
    { header: 'Retry-After', value: '5', wait: 5_000 },
    { header: 'X-RateLimit-Reset', value: '5', wait: 5_000 },
    {
      header: 'Retry-After',
      value: 'Thu, 01 Jan 2026 00:00:05 GMT',
      wait: 5_000,
    },
    { header: 'Retry-After', value: '130', wait: 130_000 },
  ])(
    'honors $header=$value across every worker',
    async ({ header, value, wait }) => {
      let rateLimited = false;
      const { operations, requests } = session(() => {
        if (!rateLimited) {
          rateLimited = true;
          return errorResponse(429, 'RATE_LIMIT_EXCEEDED', {
            headers: { [header]: value },
          });
        }
        return uploadResponse();
      });
      const progress: Progress[] = [];
      const result = await finish(
        operations.checkEnvironments(
          massiveProject.environments.slice(0, 6),
          UPLOAD_ID,
          CURRENT_ENV,
          (entry) => progress.push(entry),
        ),
      );
      expect(result.matches).toHaveLength(6);
      expect(result.failures).toEqual([]);
      expect(requests).toHaveLength(7);
      for (const request of requests.slice(1)) {
        expect(
          request.startedAt - requests[0].startedAt,
        ).toBeGreaterThanOrEqual(wait);
      }
      assertCompleteProgress(progress, 6);
    },
  );

  it.each([
    'server',
    'network',
    'transient',
    'invalid-json',
    'html',
    'rate-limit',
  ] as const)(
    'stops after five attempts for persistent %s failures',
    async (kind) => {
      const { operations, requests } = session(() => {
        if (kind === 'network')
          throw new TypeError('Synthetic connection lost');
        if (kind === 'invalid-json')
          return new Response('{', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        if (kind === 'html')
          return new Response('<html>upstream unavailable</html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          });
        if (kind === 'transient')
          return errorResponse(422, 'TEMPORARY_ERROR', { transient: true });
        if (kind === 'rate-limit')
          return errorResponse(429, 'RATE_LIMIT_EXCEEDED');
        return errorResponse(503, 'UPSTREAM_UNAVAILABLE');
      });
      const result = await finish(
        operations.checkEnvironments(
          [environment('target')],
          UPLOAD_ID,
          CURRENT_ENV,
        ),
      );
      expect(result.matches).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(requests).toHaveLength(5);
      expect(
        requests.map((request) => request.startedAt - requests[0].startedAt),
      ).toEqual([0, 1_000, 3_000, 7_000, 15_000]);
    },
  );

  it('recovers automatically from a transient server failure and then a lost connection', async () => {
    let attempts = 0;
    const { operations, requests } = session(() => {
      attempts += 1;
      if (attempts === 1) return errorResponse(503, 'UPSTREAM_UNAVAILABLE');
      if (attempts === 2) throw new TypeError('Synthetic connection lost');
      return uploadResponse();
    });
    const result = await finish(
      operations.checkEnvironments(
        [environment('target')],
        UPLOAD_ID,
        CURRENT_ENV,
      ),
    );
    expect(result.matches.map((env) => env.id)).toEqual(['target']);
    expect(result.failures).toEqual([]);
    expect(requests).toHaveLength(3);
  });
});

describe('HTTP lifetime and cancellation', () => {
  it.each(['http', 'body'] as const)(
    'aborts a stalled %s after 60 seconds and bounds retries',
    async (kind) => {
      let aborts = 0;
      const { operations, requests } = session((request) => {
        request.signal?.addEventListener(
          'abort',
          () => {
            aborts += 1;
          },
          { once: true },
        );
        if (kind === 'http') return neverCompletesUntilAborted(request);
        return new Response(
          new ReadableStream({
            start(stream) {
              request.signal?.addEventListener(
                'abort',
                () =>
                  stream.error(
                    new DOMException('Synthetic body aborted', 'AbortError'),
                  ),
                { once: true },
              );
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      });
      const operation = operations.checkEnvironments(
        [environment('target')],
        UPLOAD_ID,
        CURRENT_ENV,
      );

      await vi.advanceTimersByTimeAsync(59_999);
      expect(requests).toHaveLength(1);
      expect(aborts).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(aborts).toBe(1);

      const result = await finish(operation);
      expect(requests).toHaveLength(5);
      expect(aborts).toBe(5);
      expect(requests.every((request) => request.signal?.aborted)).toBe(true);
      expect(result.failures).toEqual([
        {
          envId: 'target',
          message: expect.stringContaining('timed out after automatic retries'),
        },
      ]);
      expect(result.matches).toEqual([]);
    },
  );

  it('cancels four actual HTTP requests and never starts the remaining queue', async () => {
    const { controller, operations, requests } = session(
      neverCompletesUntilAborted,
    );
    const progress: Progress[] = [];
    const operation = operations.checkEnvironments(
      massiveProject.environments,
      UPLOAD_ID,
      CURRENT_ENV,
      (value) => progress.push(value),
    );
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(750);
    expect(requests).toHaveLength(4);
    controller.abort();
    await rejection;
    await vi.runAllTimersAsync();
    expect(requests).toHaveLength(4);
    expect(requests.every((request) => request.signal?.aborted)).toBe(true);
    expect(progress).toEqual([{ completed: 0, total: 1_200 }]);
  });

  it('cancels workers waiting for a long shared cooldown without further requests', async () => {
    const { controller, operations, requests } = session(() =>
      errorResponse(429, 'RATE_LIMIT_EXCEEDED', {
        headers: { 'Retry-After': '130' },
      }),
    );
    const operation = operations.checkEnvironments(
      massiveProject.environments,
      UPLOAD_ID,
      CURRENT_ENV,
    );
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requests).toHaveLength(1);
    controller.abort();
    await rejection;
    await vi.runAllTimersAsync();
    expect(requests).toHaveLength(1);
  });

  it('rejects an already canceled operation before sending HTTP', async () => {
    const { controller, operations, fetchFn } = session(uploadResponse);
    controller.abort();
    await expect(operations.listEnvironments()).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(
      operations.checkEnvironments(
        [environment('target')],
        UPLOAD_ID,
        CURRENT_ENV,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      operations.deleteCopies([environment('target')], UPLOAD_ID, CURRENT_ENV),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('deletion integrity and partial failures', () => {
  it('deletes one copy per unique other environment at scale with exact progress', async () => {
    const { operations, requests } = session(uploadResponse);
    const progress: Progress[] = [];
    const result = await finish(
      operations.deleteCopies(
        [
          environment(CURRENT_ENV),
          ...massiveProject.environments,
          massiveProject.environments[0],
        ],
        UPLOAD_ID,
        CURRENT_ENV,
        (value) => progress.push(value),
      ),
    );
    expect(result.deletedEnvIds).toHaveLength(1_200);
    expect(new Set(result.deletedEnvIds).size).toBe(1_200);
    expect(result.absentEnvIds).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(requests).toHaveLength(1_200);
    for (const request of requests) {
      expect(request.method).toBe('DELETE');
      expect(request.url).toBe(`${BASE_URL}uploads/${UPLOAD_ID}`);
      expect(request.environment).not.toBe(CURRENT_ENV);
    }
    assertCompleteProgress(progress, 1_200);
  });

  it('retains failed copies, distinguishes assets already absent, and never retries definitive errors', async () => {
    const codes: Record<string, { status: number; code: string }> = {
      absent: { status: 404, code: 'NOT_FOUND' },
      used: { status: 422, code: 'UPLOAD_IS_CURRENTLY_IN_USE' },
      forbidden: { status: 403, code: 'INSUFFICIENT_PERMISSIONS' },
      invalid: { status: 404, code: 'INVALID_ENVIRONMENT' },
    };
    const { operations, requests } = session((request) => {
      const error = codes[request.environment ?? ''];
      return error ? errorResponse(error.status, error.code) : uploadResponse();
    });
    const result = await finish(
      operations.deleteCopies(
        ['success', ...Object.keys(codes)].map(environment),
        UPLOAD_ID,
        CURRENT_ENV,
      ),
    );
    expect(result.deletedEnvIds).toEqual(['success']);
    expect(result.absentEnvIds).toEqual(['absent']);
    expect(result.failures.map((failure) => failure.envId).sort()).toEqual([
      'forbidden',
      'invalid',
      'used',
    ]);
    expect(
      result.failures.find((failure) => failure.envId === 'used')?.message,
    ).toBe(
      'Asset is used by records in this environment and cannot be deleted.',
    );
    expect(requests).toHaveLength(5);
    expect(requests.every((request) => request.method === 'DELETE')).toBe(true);
  });

  it.each(['network', 'server', 'invalid-json', 'html'] as const)(
    'reconciles uncertain %s DELETE results before replaying a mutation',
    async (kind) => {
      const { operations, requests } = session((request) => {
        if (request.method === 'GET') return errorResponse(404, 'NOT_FOUND');
        if (kind === 'network')
          throw new TypeError('Synthetic DELETE response lost');
        if (kind === 'invalid-json')
          return new Response('{', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        if (kind === 'html')
          return new Response('<html>upstream unavailable</html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          });
        return errorResponse(503, 'UPSTREAM_UNAVAILABLE');
      });
      const result = await finish(
        operations.deleteCopies(
          [environment('target')],
          UPLOAD_ID,
          CURRENT_ENV,
        ),
      );
      expect(result).toEqual({
        deletedEnvIds: [],
        absentEnvIds: ['target'],
        failures: [],
      });
      expect(requests.map((request) => request.method)).toEqual([
        'DELETE',
        'GET',
      ]);
      expect(
        requests.every((request) => request.environment === 'target'),
      ).toBe(true);
      expect(
        requests.every(
          (request) => request.url === `${BASE_URL}uploads/${UPLOAD_ID}`,
        ),
      ).toBe(true);
    },
  );

  it('retries an uncertain DELETE only after confirming that the copy still exists', async () => {
    let deletes = 0;
    const { operations, requests } = session((request) => {
      if (request.method === 'GET') return uploadResponse();
      deletes += 1;
      if (deletes === 1)
        throw new TypeError('Synthetic response lost before deletion');
      return uploadResponse();
    });
    const result = await finish(
      operations.deleteCopies([environment('target')], UPLOAD_ID, CURRENT_ENV),
    );
    expect(result).toEqual({
      deletedEnvIds: ['target'],
      absentEnvIds: [],
      failures: [],
    });
    expect(requests.map((request) => request.method)).toEqual([
      'DELETE',
      'GET',
      'DELETE',
    ]);
  });

  it('reconciles even the final uncertain DELETE and bounds mutation attempts to five', async () => {
    let deletes = 0;
    const { operations, requests } = session((request) => {
      if (request.method === 'GET') {
        return deletes === 5
          ? errorResponse(404, 'NOT_FOUND')
          : uploadResponse();
      }
      deletes += 1;
      throw new TypeError('Synthetic DELETE response lost');
    });
    const result = await finish(
      operations.deleteCopies([environment('target')], UPLOAD_ID, CURRENT_ENV),
    );
    expect(result).toEqual({
      deletedEnvIds: [],
      absentEnvIds: ['target'],
      failures: [],
    });
    expect(deletes).toBe(5);
    expect(requests.map((request) => request.method)).toEqual(
      Array.from({ length: 10 }, (_, index) =>
        index % 2 === 0 ? 'DELETE' : 'GET',
      ),
    );
  });

  it('stops replaying DELETE if reconciliation cannot verify access to the copy', async () => {
    const { operations, requests } = session((request) => {
      if (request.method === 'GET')
        return errorResponse(403, 'INSUFFICIENT_PERMISSIONS');
      throw new TypeError('Synthetic DELETE response lost');
    });
    const result = await finish(
      operations.deleteCopies([environment('target')], UPLOAD_ID, CURRENT_ENV),
    );
    expect(result.deletedEnvIds).toEqual([]);
    expect(result.absentEnvIds).toEqual([]);
    expect(result.failures).toEqual([
      { envId: 'target', message: 'INSUFFICIENT_PERMISSIONS (HTTP 403)' },
    ]);
    expect(requests.map((request) => request.method)).toEqual([
      'DELETE',
      'GET',
    ]);
  });

  it('retains a copy whose five uncertain mutation attempts all reconcile as still present', async () => {
    const { operations, requests } = session((request) => {
      if (request.method === 'GET') return uploadResponse();
      throw new TypeError('Synthetic DELETE response lost');
    });
    const result = await finish(
      operations.deleteCopies([environment('target')], UPLOAD_ID, CURRENT_ENV),
    );
    expect(result.deletedEnvIds).toEqual([]);
    expect(result.absentEnvIds).toEqual([]);
    expect(result.failures.map((failure) => failure.envId)).toEqual(['target']);
    expect(
      requests.filter((request) => request.method === 'DELETE'),
    ).toHaveLength(5);
    expect(requests.filter((request) => request.method === 'GET')).toHaveLength(
      5,
    );
  });

  it('bounds failed reconciliation requests and does not replay an unverified DELETE', async () => {
    const { operations, requests } = session((request) => {
      if (request.method === 'GET')
        return errorResponse(503, 'UPSTREAM_UNAVAILABLE');
      throw new TypeError('Synthetic DELETE response lost');
    });
    const result = await finish(
      operations.deleteCopies([environment('target')], UPLOAD_ID, CURRENT_ENV),
    );
    expect(result.deletedEnvIds).toEqual([]);
    expect(result.absentEnvIds).toEqual([]);
    expect(result.failures.map((failure) => failure.envId)).toEqual(['target']);
    expect(
      requests.filter((request) => request.method === 'DELETE'),
    ).toHaveLength(1);
    expect(requests.filter((request) => request.method === 'GET')).toHaveLength(
      5,
    );
  });

  it('reconciles a timed-out DELETE after aborting its actual HTTP request', async () => {
    const { operations, requests } = session((request) =>
      request.method === 'DELETE'
        ? neverCompletesUntilAborted(request)
        : errorResponse(404, 'NOT_FOUND'),
    );
    const result = await finish(
      operations.deleteCopies([environment('target')], UPLOAD_ID, CURRENT_ENV),
    );
    expect(result).toEqual({
      deletedEnvIds: [],
      absentEnvIds: ['target'],
      failures: [],
    });
    expect(requests.map((request) => request.method)).toEqual([
      'DELETE',
      'GET',
    ]);
    expect(requests[0].signal?.aborted).toBe(true);
    expect(requests[1].startedAt - requests[0].startedAt).toBe(60_000);
  });

  it('cancels in-flight deletion without replaying mutations or scheduling reconciliation', async () => {
    const { controller, operations, requests } = session(
      neverCompletesUntilAborted,
    );
    const progress: Progress[] = [];
    const operation = operations.deleteCopies(
      massiveProject.environments,
      UPLOAD_ID,
      CURRENT_ENV,
      (value) => progress.push(value),
    );
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(750);
    expect(requests).toHaveLength(4);
    controller.abort();
    await rejection;
    await vi.runAllTimersAsync();
    expect(requests.map((request) => request.method)).toEqual([
      'DELETE',
      'DELETE',
      'DELETE',
      'DELETE',
    ]);
    expect(requests.every((request) => request.signal?.aborted)).toBe(true);
    expect(progress).toEqual([{ completed: 0, total: 1_200 }]);
  });

  it('retries a rate-limited DELETE after cooldown without an unnecessary reconciliation GET', async () => {
    let deletes = 0;
    const { operations, requests } = session(() => {
      deletes += 1;
      return deletes === 1
        ? errorResponse(429, 'RATE_LIMIT_EXCEEDED', {
            headers: { 'Retry-After': '5' },
          })
        : uploadResponse();
    });
    const result = await finish(
      operations.deleteCopies([environment('target')], UPLOAD_ID, CURRENT_ENV),
    );
    expect(result).toEqual({
      deletedEnvIds: ['target'],
      absentEnvIds: [],
      failures: [],
    });
    expect(requests.map((request) => request.method)).toEqual([
      'DELETE',
      'DELETE',
    ]);
    expect(requests[1].startedAt - requests[0].startedAt).toBe(5_000);
  });
});
