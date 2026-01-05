import { Canvas, Spinner } from "datocms-react-ui";
import type {
  FileFieldValue,
  RenderFieldExtensionCtx,
} from "datocms-plugin-sdk";
import type { Upload } from "@datocms/cma-client/dist/types/generated/SimpleSchemaTypes";
import { buildClient } from "@datocms/cma-client-browser";
import { type MouseEventHandler, useEffect, useMemo, useState } from "react";
import { humanReadableLocale } from "../utils/humanReadableLocale.ts";
import s from "./AssetLocalizationChecker.module.css";
import { getMaybeLocalizedValue } from "../utils/getMaybeLocalizedValue.ts";

type MetadataByLocale = {
  [locale: string]: {
    code: string; // same as the key, like 'en'
    label: string; // 'English'
    alt: string | null;
    title: string | null;
  };
};

type AltTitleValidators = {
  required_alt_title?: {
    title: boolean;
    alt: boolean;
  };
};

export const AssetLocalizationChecker = ({
  ctx,
}: {
  ctx: RenderFieldExtensionCtx;
}) => {
  const {
    formValues,
    fieldPath,
    currentUserAccessToken,
    field: {
      attributes: { label: fieldLabel, validators },
    },
    environment,
    locale: currentLocale,
  } = ctx;

  /** Make sure we have the token. We need this for CMA lookups. Exit early if not. **/
  if (!currentUserAccessToken) {
    (async () => {
      await ctx.alert(
        "The Asset Localization Checker plugin does not have access to your user token. Please check the plugin settings.",
      );
    })();

    return (
      <Canvas ctx={ctx}>
        <p>
          Asset Localization Checker error: No `currentUserAccessToken`
          provided. Please check your plugin settings.
        </p>
      </Canvas>
    );
  }

  /** Initialize the plugin **/
  // Set up CMA client
  const client = buildClient({
    apiToken: currentUserAccessToken,
    ...(environment ? { environment } : {}),
  });

  // States
  const [fetchedImageData, setFetchedImageData] = useState<Upload>();

  // Variables and calculations
  const imageField = getMaybeLocalizedValue(
    formValues,
    fieldPath,
  ) as FileFieldValue; // Current field the plugin is attached to
  const { upload_id, alt: fieldLevelAlt, title: fieldLevelTitle } = imageField;
  const typedValidators = validators as AltTitleValidators;
  const localesInThisRecord = (formValues?.internalLocales as string[]) ?? null;
  const isTitleRequired: boolean = !!typedValidators?.required_alt_title?.title;
  const isAltRequired: boolean = !!typedValidators?.required_alt_title?.alt;
  const isReady =
    fetchedImageData &&
    fetchedImageData?.default_field_metadata &&
    localesInThisRecord;

  const metadataByLocale = useMemo<MetadataByLocale>(() => {
    if (!fetchedImageData?.default_field_metadata) {
      return {};
    }

    return Object.fromEntries(
      localesInThisRecord.map((loc) => {
        const { title, alt } = fetchedImageData.default_field_metadata[loc];

        return [
          loc,
          {
            code: loc,
            label: humanReadableLocale(loc),
            alt,
            title,
          },
        ];
      }),
    );
  }, [fetchedImageData?.default_field_metadata, localesInThisRecord]);

  // Function to look up asset metadata from the CMA
  const fetchAsset = async () => {
    try {
      const asset = await client.uploads.find(upload_id);
      if (asset) {
        setFetchedImageData(asset);
      } else {
        throw new Error(
          `Could not retrieve asset ID ${upload_id}. Please check your console log or ask a developer for help.`,
        ); // TODO Better handle ApiErrors
      }
    } catch (error) {
      console.error(error);
      await ctx.alert(`Error: ${error}`);
    }
  };

  // Function to open the image editor (for setting alt & title)
  const editImage: MouseEventHandler<HTMLAnchorElement> = async (event) => {
    event.preventDefault();
    const uploadResult = await ctx.editUpload(upload_id);

    // If it's changed, we need to update the metadata... we don't get it from the CMS directly
    if (uploadResult) {
      await fetchAsset();
    }
  };

  // Function to edit the field-level metadata
  const editFieldMetadata: MouseEventHandler<HTMLAnchorElement> = async (
    event,
  ) => {
    event.preventDefault();
    const editResult = await ctx.editUploadMetadata(imageField);

    // If it's changed, we need to update the metadata... we don't get it from the CMS directly
    if (editResult) {
      await fetchAsset();
    }
  };

  // Initial metadata fetch
  useEffect(() => {
    fetchAsset();
  }, [upload_id]);

  const displayText = ({
    text,
    overrideText,
  }: {
    text: string | null;
    overrideText: string | null;
  }) => {
    if (!overrideText && !text?.length) {
      return (
        <div>
          <p className={s.warning}>
            ❌ Missing, set in{" "}
            <a href="" onClick={editImage}>
              {fetchedImageData?.filename ? (
                <code>{fetchedImageData?.filename}</code>
              ) : (
                <span>image metadata</span>
              )}
            </a>
          </p>
        </div>
      );
    }

    if (overrideText) {
      return (
        <div>
          <p className={s.overriddenTrue}>
            ⚠️ Overridden by{" "}
            <a href="" onClick={editFieldMetadata}>
              <code>{fieldLabel}</code>
            </a>{" "}
            field
          </p>
          <p className={s.snippet}>{overrideText}</p>
        </div>
      );
    }

    return (
      <div>
        <p className={s.ok}>✅ OK</p>
        <p className={s.snippet}>{text}</p>
      </div>
    );
  };

  if (!isReady) {
    return (
      <Canvas ctx={ctx}>
        <Spinner size={24} /> Asset Localization Checker is loading, please
        wait...
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx}>
      <table className={s.localeTable}>
        <thead>
          <tr>
            <th></th>
            <th>
              Title
              <br />
              <span className={s.helperText}>
                ({isTitleRequired ? "Required" : "Optional"})
              </span>
            </th>
            <th>
              Alt Text
              <br />
              <span className={s.helperText}>
                ({isAltRequired ? "Required" : "Optional"})
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {localesInThisRecord.map((loc) => {
            const locName = metadataByLocale[loc].label;

            return (
              <tr>
                <th scope="row">
                  {locName}
                  {loc === currentLocale && (
                    <p className={s.helperText}>(current)</p>
                  )}
                </th>
                <td>
                  {displayText({
                    text: metadataByLocale[loc].title,
                    overrideText: fieldLevelTitle,
                  })}
                </td>
                <td>
                  {displayText({
                    text: metadataByLocale[loc].alt,
                    overrideText: fieldLevelAlt,
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Canvas>
  );
};
