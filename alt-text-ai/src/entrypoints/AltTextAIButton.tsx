import { Client, buildClient } from "@datocms/cma-client-browser";
import {
  type FileFieldValue,
  RenderFieldExtensionCtx,
} from "datocms-plugin-sdk";
import { Button, Canvas, Spinner } from "datocms-react-ui";
import { isArray } from "lodash";
import get from "lodash/get";
import { useState } from "react";

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

type AltTextApiResponse = {
  alt_text?: string;
  error_code?: string;
  errors?: { base?: string[] };
};

async function fetchAlt(
  apiKey: string,
  client: Client,
  asset: FileFieldValue,
  locale: string,
): Promise<AltTextApiResponse> {
  const { url } = await client.uploads.find(asset.upload_id);

  // Instead of sending over files that are possibly too big or the wrong format, etc.,
  // we'll use Imgix to pre-transform them into a valid format and smaller size
  const transformedUrl = new URL(url);
  transformedUrl.searchParams.set("fm", "jpeg");
  transformedUrl.searchParams.set("w", "1024");

  const response = await fetch("https://alttext.ai/api/v1/images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "X-Client": "datocms",
    },
    body: JSON.stringify({
      image: {
        url: transformedUrl.toString(),
        asset_id: `dato-${asset.upload_id}`,
      },
      lang: locale,
    }),
  });

  const result: AltTextApiResponse = await response.json();
  return result;
}

async function generateAlts(
  currentFieldValue: unknown,
  ctx: RenderFieldExtensionCtx,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
) {
  if (!ctx.currentUserAccessToken) {
    await ctx.alert(
      "This plugin needs the currentUserAccessToken to function. Please give it that permission and try again.",
    );
    return;
  }

  const apiKey = ctx.plugin.attributes.parameters.apiKey;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    await ctx.alert(
      "Please configure your AltText.ai API key in the plugin settings.",
    );
    return;
  }

  setIsLoading(true);
  try {
    const client = buildClient({ apiToken: ctx.currentUserAccessToken || "" });
    const isGallery = isArray(currentFieldValue);
    if (isGallery) {
      const existingAssets = currentFieldValue as FileFieldValue[];

      const results = await Promise.allSettled(
        existingAssets.map((asset) =>
          fetchAlt(apiKey, client, asset, ctx.locale),
        ),
      );

      const errorMessages: string[] = [];
      const newAssets = existingAssets.map((asset, index) => {
        const outcome = results[index];
        if (outcome.status === "rejected") {
          const reason =
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason ?? "Unknown error");
          errorMessages.push(
            `<a href="/media/assets/${asset.upload_id}" target="_blank">Image ${asset.upload_id}</a>: <code>request_failed: ${reason}</code>`,
          );
          return asset;
        }
        const result = outcome.value;
        if (result.error_code) {
          errorMessages.push(
            `<a href="/media/assets/${asset.upload_id}" target="_blank">Image ${asset.upload_id}</a>: <code>${result.error_code}: ${result.errors?.base?.[0] ?? ""}</code>`,
          );
          return asset;
        }
        return { ...asset, alt: result.alt_text ?? asset.alt };
      });

      if (errorMessages.length > 0) {
        await ctx.alert(`Alt text errors:\n${errorMessages.join("\n")}`);
      }

      // Only update if at least one asset was successfully processed
      if (
        results.some(
          (r) => r.status === "fulfilled" && !r.value.error_code,
        )
      ) {
        ctx.setFieldValue(ctx.fieldPath, newAssets);
      }
    } else {
      const assetValue = currentFieldValue as FileFieldValue;

      const result = await fetchAlt(apiKey, client, assetValue, ctx.locale);

      if (result.error_code) {
        await ctx.alert(
          `Error fetching alt text: <code>${result.error_code}: ${result.errors?.base?.[0] ?? ""}</code>`,
        );
        return;
      }

      ctx.setFieldValue(ctx.fieldPath, { ...assetValue, alt: result.alt_text });
    }
  } catch (error) {
    console.error(error);
    const reason =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    await ctx.alert(
      `Unexpected error while generating alt text: <code>${reason}</code>`,
    );
  } finally {
    setIsLoading(false);
  }
}

const AltTextAIButton = ({ ctx }: PropTypes) => {
  const [isLoading, setIsLoading] = useState(false);
  const currentFieldValue = get(ctx.formValues, ctx.fieldPath);
  const isGallery = isArray(currentFieldValue);
  const isGalleryWithItems =
    isArray(currentFieldValue) && currentFieldValue.length > 0;

  return (
    <Canvas ctx={ctx}>
      {(isGalleryWithItems || (!isGallery && !!currentFieldValue)) && (
        <Button
          fullWidth
          disabled={isLoading}
          onClick={() => {
            generateAlts(currentFieldValue, ctx, setIsLoading);
          }}
        >
          Generate Alt Text {isLoading && <Spinner size={24} />}
        </Button>
      )}
    </Canvas>
  );
};

export default AltTextAIButton;
