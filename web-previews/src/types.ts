import type { IconName } from '@fortawesome/fontawesome-svg-core';

export type FirstInstallationParameters = Record<string, never>;

type CustomHeader = {
  name: string;
  value: string;
};

export type RawFrontend = {
  name: string;
  previewWebhook?: string;
  customHeaders?: CustomHeader[];
  disabled?: boolean;
  visualEditing?: {
    enableDraftModeUrl: string;
    initialPath?: string;
  };
};

export type RawVisualEditingSettings = {
  enableDraftModeUrl: string;
  initialPath?: string;
};

export type RawViewport = {
  name: string;
  width: string | number;
  height: string | number;
  icon: string;
};

export type Parameters = {
  frontends?: RawFrontend[];
  startOpen?: boolean;
  defaultSidebarWidth?: string;
  previewLinksSidebarDisabled?: boolean;
  previewLinksSidebarPanelDisabled?: boolean;
  iframeAllowAttribute?: string;
  defaultViewports?: RawViewport[];
};

export type Viewport = {
  name: string;
  width: number;
  height: number;
  icon: IconName;
};

export type Frontend = {
  name: string;
  disabled: boolean;
  previewLinks?: {
    apiEndpointUrl: string;
    customHeaders: CustomHeader[];
  };
  visualEditing?: {
    enableDraftModeUrl: string;
    initialPath?: string;
  };
};

export type VisualEditingSettings = {
  enableDraftModeUrl: string;
  initialPath?: string;
};

export type NormalizedParameters = {
  frontends: Frontend[];
  previewLinksSidebarPanel?: { startOpen: boolean };
  previewLinksSidebar?: { defaultWidth: number };
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
  previewLinksSidebarDisabled,
  previewLinksSidebarPanelDisabled,
  iframeAllowAttribute,
  defaultViewports,
}: Parameters): NormalizedParameters {
  return {
    frontends:
      frontends?.map((frontend) => ({
        name: frontend.name,
        disabled: Boolean(frontend.disabled),
        previewLinks: frontend.previewWebhook
          ? {
              apiEndpointUrl: frontend.previewWebhook,
              customHeaders: frontend.customHeaders || [],
            }
          : undefined,
        visualEditing: frontend.visualEditing
          ? {
              enableDraftModeUrl: frontend.visualEditing.enableDraftModeUrl,
              initialPath: frontend.visualEditing.initialPath || undefined,
            }
          : undefined,
      })) || [],
    // If not explicitly disabled (backwards compatible), create the sidebar panel config
    previewLinksSidebarPanel: previewLinksSidebarPanelDisabled
      ? undefined
      : {
          startOpen: Boolean(startOpen),
        },
    // If not explicitly disabled (backwards compatible), create the sidebar config
    previewLinksSidebar: previewLinksSidebarDisabled
      ? undefined
      : {
          defaultWidth: defaultSidebarWidth
            ? Number.parseInt(defaultSidebarWidth)
            : 900,
        },
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

export function denormalizeParameters({
  frontends,
  previewLinksSidebarPanel,
  previewLinksSidebar,
  iframeAllowAttribute,
  defaultViewports,
}: NormalizedParameters): Parameters {
  return {
    frontends: frontends.map((frontend) => {
      const rawFrontend: RawFrontend = {
        name: frontend.name,
      };

      if (frontend.disabled) {
        rawFrontend.disabled = true;
      }

      if (frontend.previewLinks) {
        rawFrontend.previewWebhook = frontend.previewLinks.apiEndpointUrl;
        if (frontend.previewLinks.customHeaders.length > 0) {
          rawFrontend.customHeaders = frontend.previewLinks.customHeaders;
        }
      }

      if (frontend.visualEditing) {
        rawFrontend.visualEditing = {
          enableDraftModeUrl: frontend.visualEditing.enableDraftModeUrl,
        };
        if (frontend.visualEditing.initialPath) {
          rawFrontend.visualEditing.initialPath =
            frontend.visualEditing.initialPath;
        }
      }

      return rawFrontend;
    }),
    startOpen: previewLinksSidebarPanel?.startOpen,
    defaultSidebarWidth: previewLinksSidebar?.defaultWidth.toString(),
    previewLinksSidebarDisabled: !previewLinksSidebar,
    previewLinksSidebarPanelDisabled: !previewLinksSidebarPanel,
    iframeAllowAttribute,
    defaultViewports: defaultViewports.map((viewport) => ({
      name: viewport.name,
      width: viewport.width,
      height: viewport.height,
      icon: viewport.icon,
    })),
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

export function getVisualEditingFrontends(
  params: NormalizedParameters,
): Frontend[] {
  return params.frontends.filter(
    (f) => !f.disabled && f.visualEditing?.enableDraftModeUrl,
  );
}

export type PreviewLinkWithFrontend = PreviewLink & {
  frontendName: string;
};
