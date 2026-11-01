import type { ApiTypes } from '@datocms/cma-client-browser';
import { buildClient } from '@datocms/cma-client-browser';
import type {
  FileFieldValue,
  RenderFieldExtensionCtx,
} from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import InfoList from 'datocms-react-ui/InfoList';
import Pill from 'datocms-react-ui/Pill';
import {
  type SVGProps,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getMaybeLocalizedValue } from '../utils/getMaybeLocalizedValue.ts';
import { humanReadableLocale } from '../utils/humanReadableLocale.ts';
import s from './AssetLocalizationChecker.module.css';

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
      attributes: { validators },
    },
    environment,
    locale: currentLocale,
  } = ctx;

  // All hooks must be declared before any conditional return
  const [fetchedImageData, setFetchedImageData] = useState<ApiTypes.Upload>();
  const [loadError, setLoadError] = useState<string>();

  // Build a stable client reference from token; client is null when token is absent
  const client = useMemo(() => {
    if (!currentUserAccessToken) {
      return null;
    }
    return buildClient({
      apiToken: currentUserAccessToken,
      ...(environment ? { environment } : {}),
      baseUrl: ctx.cmaBaseUrl,
    });
  }, [currentUserAccessToken, environment, ctx.cmaBaseUrl]);

  // Variables and calculations
  const imageField = getMaybeLocalizedValue(
    formValues,
    fieldPath,
  ) as FileFieldValue | null; // Current field the plugin is attached to (null when empty)
  const upload_id = imageField?.upload_id;
  const fieldLevelAlt = imageField?.alt ?? null;
  const fieldLevelTitle = imageField?.title ?? null;
  const typedValidators = validators as AltTitleValidators;
  const localesInThisRecord = (formValues?.internalLocales as string[]) ?? null;
  const isTitleRequired: boolean = !!typedValidators?.required_alt_title?.title;
  const isAltRequired: boolean = !!typedValidators?.required_alt_title?.alt;
  const isReady =
    fetchedImageData?.default_field_metadata && localesInThisRecord;

  const metadataByLocale = useMemo<MetadataByLocale>(() => {
    if (!fetchedImageData?.default_field_metadata) {
      return {};
    }

    // `default_field_metadata` is field-keyed (`{ alt: { en } }`): the locale
    // lives one level down, under each metadata field.
    const { alt, title } = fetchedImageData.default_field_metadata;

    return Object.fromEntries(
      localesInThisRecord.map((loc) => {
        return [
          loc,
          {
            code: loc,
            label: humanReadableLocale(loc),
            alt: alt[loc] ?? null,
            title: title[loc] ?? null,
          },
        ];
      }),
    );
  }, [fetchedImageData?.default_field_metadata, localesInThisRecord]);

  // Function to look up asset metadata from the CMA
  const fetchAsset = useCallback(async () => {
    if (!client || !upload_id) {
      return;
    }
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
      setLoadError(String(error));
      console.error(error);
      await ctx.alert(`Error: ${error}`);
    }
  }, [client, upload_id, ctx]);

  // Initial metadata fetch
  useEffect(() => {
    fetchAsset();
  }, [fetchAsset]);

  /** Guard: the field has no asset */
  if (!imageField) {
    return null;
  }

  // Function to open the image editor (for setting alt & title)
  const editImage = async () => {
    const uploadResult = await ctx.editUpload(imageField.upload_id);

    // If it's changed, we need to update the metadata... we don't get it from the CMS directly
    if (uploadResult) {
      await fetchAsset();
    }
  };

  // Function to edit the field-level metadata
  const editFieldMetadata = async () => {
    const editResult = await ctx.editUploadMetadata(imageField);

    // If it's changed, we need to update the metadata... we don't get it from the CMS directly
    if (editResult) {
      await fetchAsset();
    }
  };

  /** Guard: no token available */
  if (!currentUserAccessToken) {
    return (
      <Callout tone="warning" title="API access needed">
        This plugin needs permission to make API calls on behalf of the current
        user to read the asset's title and alt text. Ask a project admin to
        grant it in the plugin settings.
      </Callout>
    );
  }

  if (!isReady) {
    return loadError ? (
      <BlankSlate
        placement="inline"
        small
        error
        icon={<CircleExclamationIcon />}
        title="The asset metadata couldn't load"
        code={loadError}
        description="Reload the page to try again."
      />
    ) : (
      <BlankSlate
        placement="inline"
        small
        loading
        title="Loading the asset metadata"
      />
    );
  }

  // Overridden in this field first, then set on the asset, else missing
  const renderValue = (text: string | null, overrideText: string | null) => {
    if (overrideText) {
      return (
        <>
          <FeedbackDot tone="warning" /> Overridden in this field
          <Button
            tone="ghost"
            label="Edit field metadata"
            onClick={editFieldMetadata}
            className={s.action}
          />
          <div className={s.note}>“{overrideText}”</div>
        </>
      );
    }

    if (text?.length) {
      return (
        <>
          <FeedbackDot tone="success" /> Set
          <div className={s.note}>“{text}”</div>
        </>
      );
    }

    return (
      <>
        <FeedbackDot tone="danger" /> Missing
        <Button
          tone="ghost"
          label="Edit asset"
          onClick={editImage}
          className={s.action}
        />
      </>
    );
  };

  const renderRows = (key: 'title' | 'alt', overrideText: string | null) =>
    localesInThisRecord.map((loc) => (
      <InfoList.Row
        key={loc}
        title={
          <>
            {metadataByLocale[loc].label}
            {loc === currentLocale && <Pill>Current</Pill>}
          </>
        }
      >
        {renderValue(metadataByLocale[loc][key], overrideText)}
      </InfoList.Row>
    ));

  return (
    <InfoList>
      <InfoList.Group
        title={isTitleRequired ? 'Title (required)' : 'Title (optional)'}
      >
        {renderRows('title', fieldLevelTitle)}
      </InfoList.Group>
      <InfoList.Group
        title={isAltRequired ? 'Alt text (required)' : 'Alt text (optional)'}
      >
        {renderRows('alt', fieldLevelAlt)}
      </InfoList.Group>
    </InfoList>
  );
};

/** The status of an error (Font Awesome circle-exclamation) */
function CircleExclamationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M256 48a208 208 0 1 1 0 416 208 208 0 1 1 0-416zm0 464A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-384c-13.3 0-24 10.7-24 24v112c0 13.3 10.7 24 24 24s24-10.7 24-24V152c0-13.3-10.7-24-24-24zm32 224a32 32 0 1 0-64 0 32 32 0 1 0 64 0z" />
    </svg>
  );
}
