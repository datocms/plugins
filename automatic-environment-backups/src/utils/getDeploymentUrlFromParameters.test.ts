import { describe, expect, it } from "vitest";
import { getDeploymentUrlFromParameters } from "./getDeploymentUrlFromParameters";

describe("getDeploymentUrlFromParameters", () => {
  it("returns deploymentURL when configured", () => {
    expect(
      getDeploymentUrlFromParameters({
        deploymentURL: "https://new.example.com",
        netlifyURL: "https://legacy.example.com",
      }),
    ).toBe("https://new.example.com");
  });

  it("falls back to legacy netlifyURL for migration compatibility", () => {
    expect(
      getDeploymentUrlFromParameters({
        netlifyURL: "https://legacy.example.com",
      }),
    ).toBe("https://legacy.example.com");
  });

  it("returns empty string when no URL is configured", () => {
    expect(getDeploymentUrlFromParameters(undefined)).toBe("");
    expect(getDeploymentUrlFromParameters({})).toBe("");
  });
});
