import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LambdaHealthCheckError,
  verifyLambdaHealth,
} from "./verifyLambdaHealth";

const expectRejected = async (
  promise: Promise<unknown>
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
            message: "DATOCMS_RECORD_BIN_LAMBDA_PONG",
            version: "2026-02-25",
          },
          service: "record-bin-lambda-function",
          status: "ready",
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await verifyLambdaHealth({
      baseUrl: "https://record-bin.vercel.app/",
      environment: "main",
      phase: "finish_installation",
    });

    expect(result.endpoint).toBe(
      "https://record-bin.vercel.app/api/datocms/plugin-health"
    );
    expect(result.normalizedBaseUrl).toBe("https://record-bin.vercel.app");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://record-bin.vercel.app/api/datocms/plugin-health",
      expect.objectContaining({
        method: "POST",
        headers: {
          Accept: "*/*",
          "Content-Type": "application/json",
        },
      })
    );

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(requestInit.body as string) as {
      mpi: { phase: string };
    };
    expect(payload.mpi.phase).toBe("finish_installation");
  });

  it("accepts a Netlify deployment URL", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          mpi: {
            message: "DATOCMS_RECORD_BIN_LAMBDA_PONG",
            version: "2026-02-25",
          },
          service: "record-bin-lambda-function",
          status: "ready",
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await verifyLambdaHealth({
      baseUrl: "https://record-bin.netlify.app/",
      environment: "main",
      phase: "finish_installation",
    });

    expect(result.endpoint).toBe(
      "https://record-bin.netlify.app/api/datocms/plugin-health"
    );
    expect(result.normalizedBaseUrl).toBe("https://record-bin.netlify.app");
  });

  it("accepts a hostname-only URL by prepending https", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          mpi: {
            message: "DATOCMS_RECORD_BIN_LAMBDA_PONG",
            version: "2026-02-25",
          },
          service: "record-bin-lambda-function",
          status: "ready",
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await verifyLambdaHealth({
      baseUrl: "melodious-chebakia-9da33e.netlify.app",
      environment: "main",
      phase: "finish_installation",
    });

    expect(result.endpoint).toBe(
      "https://melodious-chebakia-9da33e.netlify.app/api/datocms/plugin-health"
    );
    expect(result.normalizedBaseUrl).toBe(
      "https://melodious-chebakia-9da33e.netlify.app"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://melodious-chebakia-9da33e.netlify.app/api/datocms/plugin-health",
      expect.any(Object)
    );
  });

  it("fails when URL is invalid", async () => {
    const error = await expectRejected(
      verifyLambdaHealth({
        baseUrl: "not-a-valid-url",
        environment: "main",
        phase: "finish_installation",
      })
    );

    expect(error).toBeInstanceOf(LambdaHealthCheckError);
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
        })
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const promise = expectRejected(
      verifyLambdaHealth({
        baseUrl: "https://record-bin.vercel.app",
        environment: "main",
        phase: "config_mount",
      })
    );

    await vi.advanceTimersByTimeAsync(8000);
    const error = await promise;

    expect(error.code).toBe("TIMEOUT");
    expect(error.message).toContain("timed out");
  });

  it("fails when endpoint returns non-200 status", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "INVALID_MPI_MESSAGE",
            message: "Expected DATOCMS_RECORD_BIN_PLUGIN_PING",
          },
        }),
        { status: 400 }
      )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = await expectRejected(
      verifyLambdaHealth({
        baseUrl: "https://record-bin.vercel.app",
        environment: "main",
        phase: "config_mount",
      })
    );

    expect(error.code).toBe("HTTP");
    expect(error.httpStatus).toBe(400);
    expect(error.message).toContain("INVALID_MPI_MESSAGE");
  });

  it("fails when endpoint returns invalid JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = await expectRejected(
      verifyLambdaHealth({
        baseUrl: "https://record-bin.vercel.app",
        environment: "main",
        phase: "config_mount",
      })
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
            version: "2026-02-25",
          },
          service: "record-bin-lambda-function",
          status: "ready",
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = await expectRejected(
      verifyLambdaHealth({
        baseUrl: "https://record-bin.vercel.app",
        environment: "main",
        phase: "config_mount",
      })
    );

    expect(error.code).toBe("UNEXPECTED_RESPONSE");
    expect(error.message).toContain("MPI PONG");
  });
});
