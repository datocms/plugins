import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLambdaBackupStatus,
  LambdaBackupStatusError,
} from "./fetchLambdaBackupStatus";

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

describe("fetchLambdaBackupStatus", () => {
  it("returns parsed status when endpoint responds with a valid contract", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          mpi: {
            message: "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_STATUS",
            version: "2026-02-26",
          },
          service: "datocms-backups-scheduled-function",
          status: "ready",
          scheduler: {
            provider: "vercel",
            cadence: "daily",
          },
          slots: {
            daily: {
              scope: "daily",
              executionMode: "lambda_cron",
              lastBackupAt: "2026-02-26T02:05:00.000Z",
              nextBackupAt: "2026-02-27T02:05:00.000Z",
            },
            weekly: {
              scope: "weekly",
              executionMode: "lambda_cron",
              lastBackupAt: "2026-02-20T02:35:00.000Z",
              nextBackupAt: "2026-02-27T02:35:00.000Z",
            },
          },
          checkedAt: "2026-02-26T12:00:00.000Z",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await fetchLambdaBackupStatus({
      baseUrl: "backups.netlify.app",
      environment: "main",
    });

    expect(result.scheduler.provider).toBe("vercel");
    expect(result.slots.daily.executionMode).toBe("lambda_cron");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const typedCalls =
      fetchMock.mock.calls as unknown as Array<[unknown, RequestInit | undefined]>;
    expect(typedCalls[0]?.[0]).toBe(
      "https://backups.netlify.app/api/datocms/backup-status",
    );
  });

  it("throws INVALID_RESPONSE when payload contract is malformed", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = (await expectRejected(
      fetchLambdaBackupStatus({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
      }),
    )) as LambdaBackupStatusError;

    expect(error).toBeInstanceOf(LambdaBackupStatusError);
    expect(error.code).toBe("INVALID_RESPONSE");
  });

  it("throws HTTP error details when endpoint responds with non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("failed", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = (await expectRejected(
      fetchLambdaBackupStatus({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
      }),
    )) as LambdaBackupStatusError;

    expect(error).toBeInstanceOf(LambdaBackupStatusError);
    expect(error.code).toBe("HTTP");
    expect(error.httpStatus).toBe(500);
  });
});
