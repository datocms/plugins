import type { RawApiTypes } from '@datocms/cma-client-browser';
import type { LatLonValue, RgbaColor } from './formatters';

export type RawUpload = RawApiTypes.Upload;

export type FocalPoint = {
  x: number;
  y: number;
};

export type PresentationImage = {
  url: string;
  uploadId: string | null;
  focalPoint: FocalPoint | null;
  posterTime: number | null;
};

type UploadFieldValue = {
  uploadId: string | null;
  focalPoint: FocalPoint | null;
  posterTime: number | null;
  thumbnailUrl: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asFocalPoint(value: unknown): FocalPoint | null {
  if (
    !isRecord(value) ||
    typeof value.x !== 'number' ||
    typeof value.y !== 'number'
  ) {
    return null;
  }

  if (value.x === 0.5 && value.y === 0.5) {
    return null;
  }

  return { x: value.x, y: value.y };
}

export function parseUploadFieldValue(value: unknown): UploadFieldValue | null {
  const firstValue = Array.isArray(value) ? value[0] : value;
  if (!isRecord(firstValue)) {
    return null;
  }

  const rawUploadId = firstValue.upload_id ?? firstValue.uploadId;

  return {
    uploadId:
      typeof rawUploadId === 'string' && rawUploadId ? rawUploadId : null,
    focalPoint: asFocalPoint(firstValue.focal_point ?? firstValue.focalPoint),
    posterTime:
      typeof (firstValue.poster_time ?? firstValue.posterTime) === 'number'
        ? ((firstValue.poster_time ?? firstValue.posterTime) as number)
        : null,
    thumbnailUrl:
      typeof firstValue.thumbnail_url === 'string'
        ? firstValue.thumbnail_url
        : null,
  };
}

function focalPointFromUpload(
  upload: RawUpload,
  _locales: readonly string[],
  _preferredLocale?: string,
): FocalPoint | null {
  return asFocalPoint(upload.attributes.default_field_metadata.focal_point);
}

function posterTimeFromUpload(upload: RawUpload): number | null {
  return upload.attributes.default_field_metadata.poster_time;
}

function appendCropParameters(
  url: string,
  options: {
    width?: number;
    height?: number;
    focalPoint?: FocalPoint | null;
    posterTime?: number | null;
    mux?: boolean;
    cacheKey?: string | null;
  },
): string {
  try {
    const parsed = new URL(url);
    const width = options.width ?? 80;
    const height = options.height ?? 80;
    parsed.searchParams.set(options.mux ? 'width' : 'w', String(width));
    parsed.searchParams.set(options.mux ? 'height' : 'h', String(height));
    parsed.searchParams.set('fit', 'crop');

    if (options.posterTime !== null && options.posterTime !== undefined) {
      parsed.searchParams.set('time', String(options.posterTime));
    }

    if (options.focalPoint) {
      parsed.searchParams.set('crop', 'focalpoint');
      parsed.searchParams.set('fp-x', String(options.focalPoint.x));
      parsed.searchParams.set('fp-y', String(options.focalPoint.y));
    }

    if (options.cacheKey) {
      parsed.searchParams.set('ts', options.cacheKey.slice(0, 8));
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

export function buildUploadThumbnail(
  upload: RawUpload,
  options: {
    locales: readonly string[];
    preferredLocale?: string;
    imgixHost?: string;
    focalPoint?: FocalPoint | null;
    posterTime?: number | null;
    width?: number;
    height?: number;
  },
): PresentationImage | null {
  const attributes = upload.attributes;
  const focalPoint =
    options.focalPoint ??
    focalPointFromUpload(upload, options.locales, options.preferredLocale);
  const posterTime = options.posterTime ?? posterTimeFromUpload(upload);
  const mux = Boolean(attributes.mux_playback_id);
  const baseUrl = attributes.mux_playback_id
    ? `https://image.mux.com/${attributes.mux_playback_id}/thumbnail.jpg`
    : attributes.url ||
      (options.imgixHost
        ? `https://${options.imgixHost}/${attributes.path.replace(/^\//, '')}`
        : null);

  if (!baseUrl) {
    return null;
  }

  return {
    url: appendCropParameters(baseUrl, {
      width: options.width,
      height: options.height,
      focalPoint,
      posterTime,
      mux,
      cacheKey: attributes.md5 || attributes.updated_at,
    }),
    uploadId: upload.id,
    focalPoint,
    posterTime,
  };
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function generateColorPreview(color: RgbaColor): string {
  const alpha = Math.max(0, Math.min(1, color.alpha / 255));
  const rgb = `rgb(${color.red},${color.green},${color.blue})`;

  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="124" height="124" viewBox="0 0 124 124"><defs><pattern id="c" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#fff"/><path d="M0 0h10v10H0zM10 10h10v10H10z" fill="#e0e0e0"/></pattern></defs><rect width="124" height="124" rx="10" fill="url(#c)"/><path d="M0 0h62v124H0z" fill="${rgb}"/><path d="M62 0h62v124H62z" fill="${rgb}" fill-opacity="${alpha}"/></svg>`,
  );
}

function dateParts(
  value: string,
  options: {
    dateOnly: boolean;
    locale?: string;
    timeZone?: string;
  },
): { day: string; month: string } | null {
  const date = new Date(options.dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat(options.locale, {
    day: 'numeric',
    month: 'short',
    timeZone: options.dateOnly ? 'UTC' : options.timeZone,
  });
  const parts = formatter.formatToParts(date);

  return {
    day: parts.find((part) => part.type === 'day')?.value ?? '',
    month: (
      parts.find((part) => part.type === 'month')?.value ?? ''
    ).toUpperCase(),
  };
}

export function generateCalendarPreview(
  value: string,
  options: {
    dateOnly: boolean;
    locale?: string;
    timeZone?: string;
  },
): string | null {
  const parts = dateParts(value, options);
  if (!parts) {
    return null;
  }

  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="124" height="124" viewBox="0 0 124 124"><rect x="1" y="1" width="122" height="122" rx="10" fill="#fff" stroke="#d0d0d0"/><path d="M2 12A10 10 0 0 1 12 2h100a10 10 0 0 1 10 10v30H2z" fill="#f00"/><text x="62" y="25" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#fff">${parts.month}</text><text x="62" y="84" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="56" font-weight="700" fill="#000">${parts.day}</text></svg>`,
  );
}

export function generateMapPreview(
  value: LatLonValue,
  apiKey: string | undefined,
): string | null {
  if (!apiKey) {
    return null;
  }

  const center = `${value.latitude},${value.longitude}`;
  const params = new URLSearchParams({
    center,
    zoom: '14',
    size: '120x120',
    scale: '2',
    key: apiKey,
  });
  const marker = `markers=color:red%7Csize:mid%7C${center}`;

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}&${marker}`;
}

export function directPresentationImage(url: string): PresentationImage {
  return {
    url,
    uploadId: null,
    focalPoint: null,
    posterTime: null,
  };
}
