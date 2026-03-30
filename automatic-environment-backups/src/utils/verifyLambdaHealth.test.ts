import { afterEach, describe, expect, it, vi } from "vitest";
import { LambdaHealthCheckError, verifyLambdaHealth } from "./verifyLambdaHealth";

const expectRejected = async (
  promise: Promise<unknown>,
): Promise<LambdaHealthCheckError> => {
  try {
    await promise;
    throw new Error("Expected promise to reject");
  } catch (error) {
    return error as LambdaHealthCheckError;
  }
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verifyLambdaHealth", () => {
  it("accepts a valid health handshake response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          mpi: {
            message: "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_PONG",
            version: "2026-02-26",
          },
          service: "datocms-backups-scheduled-function",
          status: "ready",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await verifyLambdaHealth({
      baseUrl: "https://backups.vercel.app/",
      environment: "main",
      phase: "config_connect",
      lambdaAuthSecret: "shared-secret",
    });

    expect(result.endpoint).toBe(
      "https://backups.vercel.app/api/datocms/plugin-health",
    );
    expect(result.normalizedBaseUrl).toBe("https://backups.vercel.app");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const typedCalls =
      fetchMock.mock.calls as unknown as Array<[unknown, RequestInit | undefined]>;
    expect(typedCalls[0]?.[1]?.headers).toMatchObject({
      "X-Datocms-Backups-Auth": "shared-secret",
    });
  });

  it("accepts a hostname-only URL by prepending https", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          mpi: {
            message: "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_PONG",
            version: "2026-02-26",
          },
          service: "datocms-backups-scheduled-function",
          status: "ready",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await verifyLambdaHealth({
      baseUrl: "backups.netlify.app",
      environment: "main",
      phase: "config_connect",
      lambdaAuthSecret: "shared-secret",
    });

    expect(result.endpoint).toBe(
      "https://backups.netlify.app/api/datocms/plugin-health",
    );
  });

  it("fails when URL is invalid", async () => {
    const error = await expectRejected(
      verifyLambdaHealth({
        baseUrl: "not-a-valid-url",
        environment: "main",
        phase: "config_connect",
        lambdaAuthSecret: "shared-secret",
      }),
    );

    expect(error.code).toBe("INVALID_URL");
  });

  it("fails when request times out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortError = new Error("aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const promise = expectRejected(
      verifyLambdaHealth({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        phase: "config_mount",
        lambdaAuthSecret: "shared-secret",
      }),
    );

    await vi.advanceTimersByTimeAsync(8000);
    const error = await promise;

    expect(error.code).toBe("TIMEOUT");
  });

  it("fails when endpoint returns non-200 status", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "INVALID_MPI_MESSAGE",
            message: "Expected ping message",
          },
        }),
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = await expectRejected(
      verifyLambdaHealth({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        phase: "config_mount",
        lambdaAuthSecret: "shared-secret",
      }),
    );

    expect(error.code).toBe("HTTP");
    expect(error.httpStatus).toBe(400);
  });

  it("fails when endpoint returns invalid JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = await expectRejected(
      verifyLambdaHealth({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        phase: "config_mount",
        lambdaAuthSecret: "shared-secret",
      }),
    );

    expect(error.code).toBe("INVALID_JSON");
  });

  it("fails when JSON does not match expected MPI response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          mpi: {
            message: "WRONG_MESSAGE",
            version: "2026-02-26",
          },
          service: "datocms-backups-scheduled-function",
          status: "ready",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = await expectRejected(
      verifyLambdaHealth({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        phase: "config_mount",
        lambdaAuthSecret: "shared-secret",
      }),
    );

    expect(error.code).toBe("UNEXPECTED_RESPONSE");
  });

  it("fails when lambda auth secret is missing", async () => {
    const error = await expectRejected(
      verifyLambdaHealth({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        phase: "config_connect",
        lambdaAuthSecret: "",
      }),
    );

    expect(error.code).toBe("MISSING_AUTH_SECRET");
  });
});
