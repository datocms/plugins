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

export type Parameters = {
  frontends?: Frontend[];
  startOpen?: boolean;
  defaultSidebarWidth?: string;
  iframeAllowAttribute?: string;
};

export type NormalizedParameters = {
  frontends: Frontend[];
  startOpen: boolean;
  defaultSidebarWidth: string;
  iframeAllowAttribute: string | undefined;
};

export function normalizeParameters({
  frontends,
  startOpen,
  defaultSidebarWidth,
  iframeAllowAttribute,
}: Parameters): NormalizedParameters {
  return {
    frontends: frontends || [],
    startOpen: Boolean(startOpen),
    defaultSidebarWidth: defaultSidebarWidth || '900',
    iframeAllowAttribute,
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
