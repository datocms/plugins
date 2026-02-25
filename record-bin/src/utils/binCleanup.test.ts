import { afterEach, describe, expect, it, vi } from "vitest";
import binCleanup from "./binCleanup";
import { cleanupRecordBinWithoutLambda } from "./lambdaLessCleanup";

vi.mock("./lambdaLessCleanup", () => ({
  cleanupRecordBinWithoutLambda: vi.fn(),
}));

const createCtxMock = (
  parameters: Record<string, unknown>
): {
  plugin: {
    attributes: {
      parameters: Record<string, unknown>;
    };
  };
  environment: string;
  currentUserAccessToken: string;
  updatePluginParameters: ReturnType<typeof vi.fn>;
} => ({
  plugin: {
    attributes: {
      parameters,
    },
  },
  environment: "main",
  currentUserAccessToken: "token",
  updatePluginParameters: vi.fn(),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("binCleanup", () => {
  it("uses lambda cleanup when deployment URL is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const ctx = createCtxMock({
      deploymentURL: "https://record-bin.example.com",
      automaticBinCleanup: {
        numberOfDays: 30,
        timeStamp: "",
      },
    });

    await binCleanup(ctx as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://record-bin.example.com",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(cleanupRecordBinWithoutLambda).not.toHaveBeenCalled();
    expect(ctx.updatePluginParameters).toHaveBeenCalledTimes(1);
  });

  it("uses Lambda-less cleanup when no deployment URL is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(cleanupRecordBinWithoutLambda).mockResolvedValue({
      deletedCount: 2,
      skipped: false,
    });

    const ctx = createCtxMock({
      automaticBinCleanup: {
        numberOfDays: 10,
        timeStamp: "",
      },
    });

    await binCleanup(ctx as never);

    expect(cleanupRecordBinWithoutLambda).toHaveBeenCalledWith({
      currentUserAccessToken: "token",
      environment: "main",
      numberOfDays: 10,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.updatePluginParameters).toHaveBeenCalledTimes(1);
  });

  it("skips cleanup if it already ran today", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const today = new Date().toISOString().split("T")[0];
    const ctx = createCtxMock({
      deploymentURL: "https://record-bin.example.com",
      automaticBinCleanup: {
        numberOfDays: 30,
        timeStamp: today,
      },
    });

    await binCleanup(ctx as never);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cleanupRecordBinWithoutLambda).not.toHaveBeenCalled();
    expect(ctx.updatePluginParameters).not.toHaveBeenCalled();
  });
});
