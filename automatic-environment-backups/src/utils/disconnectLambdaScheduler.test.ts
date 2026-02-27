import { afterEach, describe, expect, it, vi } from "vitest";
import { LambdaHealthCheckError } from "./verifyLambdaHealth";
import {
  disconnectLambdaScheduler,
  DisconnectLambdaSchedulerError,
} from "./disconnectLambdaScheduler";

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

describe("disconnectLambdaScheduler", () => {
  it("uses the primary /api/datocms/scheduler-disconnect endpoint when available", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await disconnectLambdaScheduler({
      baseUrl: "backups.netlify.app",
      environment: "main",
    });

    expect(result.endpoint).toBe(
      "https://backups.netlify.app/api/datocms/scheduler-disconnect",
    );
    expect(result.attemptName).toBe("/api/datocms/scheduler-disconnect");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to legacy Netlify endpoint when modern route fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/.netlify/functions/scheduler-disconnect")) {
        return new Response("scheduler disabled", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await disconnectLambdaScheduler({
      baseUrl: "https://backups.vercel.app",
      environment: "main",
    });

    expect(result.endpoint).toBe(
      "https://backups.vercel.app/.netlify/functions/scheduler-disconnect",
    );
    expect(result.attemptName).toBe("/.netlify/functions/scheduler-disconnect");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns detailed failures when all attempts fail", async () => {
    const fetchMock = vi.fn(
      async () => new Response("route not available", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const error = (await expectRejected(
      disconnectLambdaScheduler({
        baseUrl: "https://backups.vercel.app",
        environment: "main",
      }),
    )) as DisconnectLambdaSchedulerError;

    expect(error).toBeInstanceOf(DisconnectLambdaSchedulerError);
    expect(error.failures).toHaveLength(2);
    expect(error.failures[0].endpoint).toBe(
      "https://backups.vercel.app/api/datocms/scheduler-disconnect",
    );
  });

  it("fails fast when URL is invalid", async () => {
    const error = (await expectRejected(
      disconnectLambdaScheduler({
        baseUrl: "not-a-valid-url",
        environment: "main",
      }),
    )) as LambdaHealthCheckError;

    expect(error).toBeInstanceOf(LambdaHealthCheckError);
    expect(error.code).toBe("INVALID_URL");
  });
});
