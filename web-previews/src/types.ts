import type { IconName } from '@fortawesome/fontawesome-svg-core';

export type FirstInstallationParameters = Record<string, never>;

type CustomHeader = {
  name: string;
  value: string;
};

export type Frontend = {
  name: string;
  previewWebhook: string;
  customHeaders: CustomHeader[];
};

export type RawViewport = {
  name: string;
  width: string | number;
  height: string | number;
  icon: string;
};

export type Parameters = {
  frontends?: Frontend[];
  startOpen?: boolean;
  defaultSidebarWidth?: string;
  iframeAllowAttribute?: string;
  defaultViewports?: RawViewport[];
};

export type Viewport = {
  name: string;
  width: number;
  height: number;
  icon: IconName;
};

export type NormalizedParameters = {
  frontends: Frontend[];
  startOpen: boolean;
  defaultSidebarWidth: number;
  iframeAllowAttribute: string | undefined;
  defaultViewports: Viewport[];
};

const DEFAULT_VIEWPORTS: readonly Viewport[] = [
  { name: 'Mobile', width: 375, height: 667, icon: 'mobile-alt' },
  { name: 'Tablet', width: 768, height: 1024, icon: 'tablet-alt' },
  { name: 'Desktop', width: 1280, height: 800, icon: 'desktop-alt' },
] as const;

export const MIN_VIEWPORT_DIMENSION = 200;
export const MAX_VIEWPORT_DIMENSION = 3840;

export function normalizeParameters({
  frontends,
  startOpen,
  defaultSidebarWidth,
  iframeAllowAttribute,
  defaultViewports,
}: Parameters): NormalizedParameters {
  return {
    frontends: frontends || [],
    startOpen: Boolean(startOpen),
    defaultSidebarWidth: defaultSidebarWidth
      ? Number.parseInt(defaultSidebarWidth)
      : 900,
    iframeAllowAttribute,
    defaultViewports: defaultViewports?.map((viewport) => ({
      name: viewport.name,
      width:
        typeof viewport.width === 'number'
          ? viewport.width
          : Number.parseInt(viewport.width),
      height:
        typeof viewport.height === 'number'
          ? viewport.height
          : Number.parseInt(viewport.height),
      icon: viewport.icon as IconName,
    })) || [...DEFAULT_VIEWPORTS],
  };
}

export type PreviewLink = {
  url: string;
  label: string;
  reloadPreviewOnRecordUpdate: boolean | { delayInMs: number };
};

export type Response = {
  previewLinks: PreviewLink[];
};

export function isValidPreviewLink(data: unknown): data is PreviewLink {
  return Boolean(
    typeof data === 'object' && data && 'label' in data && 'url' in data,
  );
}

export function isValidResponse(data: unknown): data is Response {
  if (typeof data !== 'object' || !data || !('previewLinks' in data)) {
    return false;
  }

  const previewLinks = (data as any).previewLinks;

  if (!Array.isArray(previewLinks)) {
    return false;
  }

  return previewLinks.every(isValidPreviewLink);
}
