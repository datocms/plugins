/** The page of the plugin in the marketplace, with the setup docs */
export const MARKETPLACE_URL =
  'https://www.datocms.com/marketplace/plugins/i/datocms-plugin-web-previews';

export const IFRAME_ALLOW_DOCS_URL =
  'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#allow';

export const FRONTEND_DOC_LINKS = [
  {
    href: `${MARKETPLACE_URL}#the-preview-links-api-endpoint`,
    label: 'Preview Links endpoint',
  },
  {
    href: `${MARKETPLACE_URL}#the-enable-draft-mode-route`,
    label: 'Draft mode URL',
  },
  {
    href: 'https://www.datocms.com/docs/visual-editing',
    label: 'Visual Editing',
  },
  {
    href: `${MARKETPLACE_URL}#implementation-examples`,
    label: 'Framework examples',
  },
];

export const DISPLAY_DOC_LINKS = [
  { href: `${MARKETPLACE_URL}#sidebar-panel`, label: 'Sidebar panel' },
  {
    href: `${MARKETPLACE_URL}#full-preview-sidebar`,
    label: 'Website preview tab',
  },
];

export const IFRAME_DOC_LINKS = [
  {
    href: `${MARKETPLACE_URL}#content-security-policy`,
    label: 'Content Security Policy',
  },
];
