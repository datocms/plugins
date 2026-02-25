import { describe, expect, it } from "vitest";
import { getRuntimeMode } from "./getRuntimeMode";

describe("getRuntimeMode", () => {
  it("prefers explicit runtimeMode from plugin parameters", () => {
    expect(
      getRuntimeMode({
        runtimeMode: "lambdaless",
        deploymentURL: "https://record-bin.example.com",
      })
    ).toBe("lambdaless");

    expect(
      getRuntimeMode({
        runtimeMode: "lambda",
      })
    ).toBe("lambda");
  });

  it("accepts legacy boolean lambdaFullMode parameter", () => {
    expect(
      getRuntimeMode({
        lambdaFullMode: true,
      })
    ).toBe("lambda");

    expect(
      getRuntimeMode({
        lambdaFullMode: false,
        deploymentURL: "https://record-bin.example.com",
      })
    ).toBe("lambdaless");
  });

  it("returns lambda when deploymentURL exists", () => {
    expect(
      getRuntimeMode({
        deploymentURL: "https://record-bin.example.com",
      })
    ).toBe("lambda");
  });

  it("returns lambda when vercelURL exists and deploymentURL is empty", () => {
    expect(
      getRuntimeMode({
        deploymentURL: "   ",
        vercelURL: "https://record-bin.example.com",
      })
    ).toBe("lambda");
  });

  it("returns lambdaless when no URL is configured", () => {
    expect(getRuntimeMode(undefined)).toBe("lambdaless");
    expect(getRuntimeMode({})).toBe("lambdaless");
    expect(getRuntimeMode({ deploymentURL: "" })).toBe("lambdaless");
  });
});
