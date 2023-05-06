export type FirstInstallationParameters = {};

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
  frontends: Frontend[];
  startOpen?: boolean;
};

export type PreviewLink = {
  url: string;
  label: string;
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
