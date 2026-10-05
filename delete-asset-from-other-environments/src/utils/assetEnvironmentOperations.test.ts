import { afterEach, describe, expect, it, vi } from 'vitest';
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

const environments = Array.from({ length: 20 }, (_, index) =>
  environment(`environment-${index}`),
);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function uploadResponse() {
  return jsonResponse({ data: { id: UPLOAD_ID, type: 'upload' } });
}

function errorResponse(status: number, code: string) {
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
          },
        },
      ],
    },
    status,
  );
}

type CapturedRequest = {
  url: string;
  method: string;
  headers: Headers;
  environment: string | null;
};

function session(handler: (request: CapturedRequest) => Response) {
  const controller = new AbortController();
  const requests: CapturedRequest[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const headers = new Headers(init?.headers);
    const request: CapturedRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? 'GET',
      headers,
      environment: headers.get('x-environment'),
    };
    requests.push(request);
    return handler(request);
  });
  vi.stubGlobal('fetch', fetchFn);
  const operations = createAssetEnvironmentOperations({
    apiToken: 'synthetic-token',
    baseUrl: BASE_URL,
    signal: controller.signal,
  });
  return { controller, fetchFn, requests, operations };
}

function assertCompleteProgress(progress: Progress[], total: number) {
  expect(progress).toEqual(
    Array.from({ length: total + 1 }, (_, completed) => ({ completed, total })),
  );
}

function tick() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bounded environment workers', () => {
  it('processes environments with at most four tasks and exact progress', async () => {
    let active = 0;
    let peakActive = 0;
    const progress: Progress[] = [];
    const task = vi.fn(async (env: Environment) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await tick();
      active -= 1;
      if (env.id === 'environment-7') throw new Error('Synthetic failure');
      return env.id;
    });

    const result = await runEnvironmentTasks(
      environments,
      new AbortController().signal,
      task,
      (value) => progress.push(value),
    );

    expect(peakActive).toBe(4);
    expect(task).toHaveBeenCalledTimes(20);
    expect(result.results).toHaveLength(19);
    expect(result.failures).toEqual([
      {
        envId: 'environment-7',
        message:
          'Could not complete the request. Check your connection and access permissions.',
      },
    ]);
    assertCompleteProgress(progress, 20);
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
      environments,
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
    expect(progress).toEqual([{ completed: 0, total: 20 }]);
  });
});

describe('environment discovery and single-asset lookup', () => {
  it('gets the environment endpoint once with the configured base URL', async () => {
    const { operations, requests } = session(() =>
      jsonResponse({ data: environments }),
    );
    expect(await operations.listEnvironments()).toEqual(environments);
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

  it('looks up the selected ID once in every other unique environment', async () => {
    const { operations, requests } = session((request) => {
      const index = Number(request.environment?.replace('environment-', ''));
      return index % 2 === 0
        ? uploadResponse()
        : errorResponse(404, 'NOT_FOUND');
    });
    const progress: Progress[] = [];
    const result = await operations.checkEnvironments(
      [environment(CURRENT_ENV), ...environments, ...environments.slice(0, 3)],
      UPLOAD_ID,
      CURRENT_ENV,
      (value) => progress.push(value),
    );

    expect(result.matches).toHaveLength(10);
    expect(result.failures).toEqual([]);
    expect(requests).toHaveLength(20);
    for (const request of requests) {
      expect(request.url).toBe(`${BASE_URL}uploads/${UPLOAD_ID}`);
      expect(request.method).toBe('GET');
      expect(request.environment).not.toBe(CURRENT_ENV);
    }
    assertCompleteProgress(progress, 20);
  });

  it('distinguishes an absent asset from inaccessible or invalid environments', async () => {
    const responses: Record<string, () => Response> = {
      present: uploadResponse,
      missing: () => errorResponse(404, 'NOT_FOUND'),
      invalid: () => errorResponse(404, 'INVALID_ENVIRONMENT'),
      forbidden: () => errorResponse(403, 'INSUFFICIENT_PERMISSIONS'),
    };
    const { operations, requests } = session((request) =>
      responses[request.environment ?? 'missing'](),
    );
    const result = await operations.checkEnvironments(
      Object.keys(responses).map(environment),
      UPLOAD_ID,
      CURRENT_ENV,
    );

    expect(result.matches.map((env) => env.id)).toEqual(['present']);
    expect(result.failures.map((failure) => failure.envId).sort()).toEqual([
      'forbidden',
      'invalid',
    ]);
    expect(requests).toHaveLength(4);
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

describe('deletion results and partial failures', () => {
  it('retains failed copies and distinguishes assets already absent', async () => {
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
    const result = await operations.deleteCopies(
      ['success', ...Object.keys(codes)].map(environment),
      UPLOAD_ID,
      CURRENT_ENV,
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
    for (const request of requests) {
      expect(request.method).toBe('DELETE');
      expect(request.url).toBe(`${BASE_URL}uploads/${UPLOAD_ID}`);
    }
  });
});
