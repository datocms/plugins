export const SYMBOL_FOR_PRIMARY_ENVIRONMENT = '__PRIMARY__';

export type EditUrlInfo = {
  environment: string;
  itemTypeId: string;
  itemId: string;
  fieldPath: string;
};

export type ContentLinkState = {
  clickToEditEnabled: boolean;
  path: string;
  itemIdsPerEnvironment: Record<string, string[]>;
};

// Methods that we expose
export interface WebPreviewsMethods {
  onStateChange: (payload: ContentLinkState) => void;
  openItem: (payload: EditUrlInfo) => void;
}

// Methods that @datocms/content-link exposes
export interface ContentLinkMethods {
  navigateTo: (payload: { path: string }) => Promise<void>;
  setClickToEditEnabled: (payload: { enabled: boolean }) => Promise<void>;
}
