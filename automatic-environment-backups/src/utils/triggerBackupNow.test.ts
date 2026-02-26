import { afterEach, describe, expect, it, vi } from "vitest";
import { LambdaHealthCheckError } from "./verifyLambdaHealth";
import { triggerBackupNow, TriggerBackupNowError } from "./triggerBackupNow";

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

describe("triggerBackupNow", () => {
  it("uses the primary /api/datocms/backup-now endpoint when available", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await triggerBackupNow({
      baseUrl: "backups.netlify.app",
      environment: "main",
    });

    expect(result.endpoint).toBe("https://backups.netlify.app/api/datocms/backup-now");
    expect(result.attemptName).toBe("/api/datocms/backup-now (backup_now)");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const typedCalls =
      fetchMock.mock.calls as unknown as Array<[unknown, RequestInit | undefined]>;
    const requestInit = typedCalls[0]?.[1];
    expect(requestInit?.method).toBe("POST");
    expect(String(requestInit?.body)).toContain("\"event_type\":\"backup_now\"");
  });

  it("falls back to legacy Netlify daily endpoint when modern routes fail", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/.netlify/functions/dailyBackup")) {
        return new Response("daily backup triggered", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await triggerBackupNow({
      baseUrl: "https://backups.vercel.app",
      environment: "main",
    });

    expect(result.endpoint).toBe("https://backups.vercel.app/.netlify/functions/dailyBackup");
    expect(result.attemptName).toBe("/.netlify/functions/dailyBackup");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("returns detailed failure info when all attempts fail", async () => {
    const fetchMock = vi.fn(async () => new Response("route not available", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = (await expectRejected(
      triggerBackupNow({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
      }),
    )) as TriggerBackupNowError;

    expect(error).toBeInstanceOf(TriggerBackupNowError);
    expect(error.failures).toHaveLength(8);
    expect(error.failures[0].endpoint).toBe("https://backups.vercel.app/api/datocms/backup-now");
    expect(error.failures[0].httpStatus).toBe(404);
  });

  it("fails fast when URL is invalid", async () => {
    const error = (await expectRejected(
      triggerBackupNow({
        baseUrl: "not-a-valid-url",
        environment: "main",
      }),
    )) as LambdaHealthCheckError;

    expect(error).toBeInstanceOf(LambdaHealthCheckError);
    expect(error.code).toBe("INVALID_URL");
  });
});
