import { describe, expect, it, vi } from "vitest";
import { createDebugLogger, isDebugEnabled } from "./debugLogger";

describe("isDebugEnabled", () => {
  it("returns true only when debug is explicitly true", () => {
    expect(isDebugEnabled({ debug: true })).toBe(true);
    expect(isDebugEnabled({ debug: false })).toBe(false);
    expect(isDebugEnabled({})).toBe(false);
    expect(isDebugEnabled(undefined)).toBe(false);
  });
});

describe("createDebugLogger", () => {
  it("writes logs when enabled", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createDebugLogger(true, "ConfigScreen");

    logger.log("hello", { foo: "bar" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toBe("[automatic-backups][ConfigScreen]");
    logSpy.mockRestore();
  });

  it("does not write logs when disabled", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createDebugLogger(false, "ConfigScreen");

    logger.warn("hidden warning");

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
