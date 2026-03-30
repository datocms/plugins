import { describe, expect, it } from "vitest";
import { DEPLOY_PROVIDER_OPTIONS, PLUGIN_README_URL } from "./deployProviders";

describe("DEPLOY_PROVIDER_OPTIONS", () => {
  it("contains the expected providers, labels, and urls", () => {
    expect(DEPLOY_PROVIDER_OPTIONS).toEqual([
      {
        provider: "vercel",
        label: "Vercel",
        url: "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarcelofinamorvieira%2Frecord-bin-lambda-function&env=DATOCMS_FULLACCESS_API_TOKEN&project-name=datocms-record-bin-lambda-function&repo-name=datocms-record-bin-lambda-function",
      },
      {
        provider: "netlify",
        label: "Netlify",
        url: "https://app.netlify.com/start/deploy?repository=https://github.com/marcelofinamorvieira/record-bin-lambda-function",
      },
      {
        provider: "cloudflare",
        label: "Cloudflare",
        url: "https://github.com/marcelofinamorvieira/record-bin-lambda-function#deploying-on-cloudflare-workers",
      },
    ]);
  });
});

describe("PLUGIN_README_URL", () => {
  it("is a valid absolute URL", () => {
    expect(() => new URL(PLUGIN_README_URL)).not.toThrow();
    expect(PLUGIN_README_URL).toBe(
      "https://github.com/datocms/plugins/tree/master/record-bin#readme"
    );
  });
});
