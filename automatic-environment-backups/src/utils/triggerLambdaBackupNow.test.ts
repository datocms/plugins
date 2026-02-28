import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LambdaBackupNowError,
  triggerLambdaBackupNow,
} from "./triggerLambdaBackupNow";

const expectRejected = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
    throw new Error("Expected promise to reject");
  } catch (error) {
    return error;
  }
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("triggerLambdaBackupNow", () => {
  it("returns parsed payload when endpoint responds with valid contract", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          mpi: {
            message: "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_BACKUP_NOW",
            version: "2026-02-26",
          },
          service: "datocms-backups-scheduled-function",
          status: "ready",
          backup: {
            scope: "daily",
            executionMode: "lambda_cron",
            createdEnvironmentId: "backup-plugin-daily-2026-02-28",
            deletedEnvironmentId: "backup-plugin-daily-2026-02-27",
            completedAt: "2026-02-28T02:05:00.000Z",
          },
          checkedAt: "2026-02-28T02:05:00.000Z",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await triggerLambdaBackupNow({
      baseUrl: "backups.netlify.app",
      environment: "main",
      scope: "daily",
      lambdaAuthSecret: "shared-secret",
    });

    expect(result.scope).toBe("daily");
    expect(result.executionMode).toBe("lambda_cron");
    expect(result.createdEnvironmentId).toBe("backup-plugin-daily-2026-02-28");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const typedCalls =
      fetchMock.mock.calls as unknown as Array<[unknown, RequestInit | undefined]>;
    expect(typedCalls[0]?.[0]).toBe("https://backups.netlify.app/api/datocms/backup-now");
    expect(typedCalls[0]?.[1]?.headers).toMatchObject({
      "X-Datocms-Backups-Auth": "shared-secret",
    });
  });

  it("throws INVALID_RESPONSE when contract is malformed", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = (await expectRejected(
      triggerLambdaBackupNow({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        scope: "weekly",
        lambdaAuthSecret: "shared-secret",
      }),
    )) as LambdaBackupNowError;

    expect(error).toBeInstanceOf(LambdaBackupNowError);
    expect(error.code).toBe("INVALID_RESPONSE");
  });

  it("throws HTTP details when endpoint responds with non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("failed", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = (await expectRejected(
      triggerLambdaBackupNow({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        scope: "monthly",
        lambdaAuthSecret: "shared-secret",
      }),
    )) as LambdaBackupNowError;

    expect(error).toBeInstanceOf(LambdaBackupNowError);
    expect(error.code).toBe("HTTP");
    expect(error.httpStatus).toBe(500);
  });

  it("throws MISSING_AUTH_SECRET when lambda auth secret is blank", async () => {
    const error = (await expectRejected(
      triggerLambdaBackupNow({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        scope: "biweekly",
        lambdaAuthSecret: "",
      }),
    )) as LambdaBackupNowError;

    expect(error).toBeInstanceOf(LambdaBackupNowError);
    expect(error.code).toBe("MISSING_AUTH_SECRET");
  });

  it("throws TIMEOUT when request exceeds timeout budget", async () => {
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
      triggerLambdaBackupNow({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        scope: "daily",
        lambdaAuthSecret: "shared-secret",
      }),
    );

    await vi.advanceTimersByTimeAsync(60000);
    const error = (await promise) as LambdaBackupNowError;
    expect(error.code).toBe("TIMEOUT");
  });

  it("throws NETWORK when fetch throws a non-abort error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = (await expectRejected(
      triggerLambdaBackupNow({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
        scope: "daily",
        lambdaAuthSecret: "shared-secret",
      }),
    )) as LambdaBackupNowError;

    expect(error.code).toBe("NETWORK");
  });
});
