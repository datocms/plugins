import { describe, expect, it } from "vitest";
import { getDeploymentUrlFromParameters } from "./getDeploymentUrlFromParameters";

describe("getDeploymentUrlFromParameters", () => {
  it("prefers deploymentURL when present", () => {
    const result = getDeploymentUrlFromParameters({
      deploymentURL: "https://record-bin.example.com",
      vercelURL: "https://record-bin.vercel.app",
    });

    expect(result).toBe("https://record-bin.example.com");
  });

  it("falls back to legacy vercelURL", () => {
    const result = getDeploymentUrlFromParameters({
      vercelURL: "https://record-bin.vercel.app",
    });

    expect(result).toBe("https://record-bin.vercel.app");
  });

  it("returns empty string when no URL is configured", () => {
    expect(getDeploymentUrlFromParameters(undefined)).toBe("");
    expect(getDeploymentUrlFromParameters({})).toBe("");
  });
});
