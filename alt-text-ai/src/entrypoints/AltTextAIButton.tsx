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

async function fetchAlt(apiKey: string, client: Client, asset: FileFieldValue) {
  const { url } = await client.uploads.find(asset.upload_id);

  // Instead of sending over files that are possibly too big or the wrong format, etc.,
  // we'll use Imgix to pre-transform them into a valid format and smaller size
  let transformedUrl = new URL(url);
  transformedUrl.searchParams.set("fm", "jpeg");
  transformedUrl.searchParams.set("w", "1024");

  const result = await (
    await fetch("https://alttext.ai/api/v1/images", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey ?? "",
      },
      body: JSON.stringify({
        image: {
          url: transformedUrl.toString(),
        },
      }),
    })
  ).json();

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

  setIsLoading(true);
  try {
    const client = buildClient({ apiToken: ctx.currentUserAccessToken || "" });
    const isGallery = isArray(currentFieldValue);
    if (isGallery) {
      const existingAssets = currentFieldValue as FileFieldValue[];
      const newAssets = [];
      for (const asset of existingAssets) {
        console.log("asset", asset);
        const result = await fetchAlt(
          ctx.plugin.attributes.parameters.apiKey as string,
          client,
          asset,
        );

        if (result.error_code) {
          ctx.alert(
            `Alt text error for <a href="/media/assets/${asset.upload_id}" target="_blank">image ${asset.upload_id}</a>: <code>${result.error_code}: ${result.errors?.base?.[0] ?? ""}</code>`,
          );
        }

        asset.alt = result.alt_text;
        newAssets.push(asset);
      }
      ctx.setFieldValue(ctx.fieldPath, newAssets);
    } else {
      const assetValue = currentFieldValue as FileFieldValue;

      const result = await fetchAlt(
        ctx.plugin.attributes.parameters.apiKey as string,
        client,
        assetValue,
      );

      if (result.error_code) {
        await ctx.alert(
          `Error fetching alt text: <code>${result.error_code}: ${result.errors?.base?.[0] ?? ""}</code>`,
        );
        return;
      }

      assetValue.alt = result.alt_text;
      ctx.setFieldValue(ctx.fieldPath, assetValue);
    }
  } catch (error) {
    console.log(error);
  } finally {
    setIsLoading(false);
  }
}

const AltTextAIButton = ({ ctx }: PropTypes) => {
  const [isLoading, setIsLoading] = useState(false);
  const currentFieldValue = get(ctx.formValues, ctx.fieldPath);
  const isGallery = isArray(currentFieldValue);
  const isGalleryWithItems =
    isArray(currentFieldValue) && currentFieldValue.length;

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
