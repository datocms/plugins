/** The page of the plugin in the marketplace, with the setup docs */
const MARKETPLACE_URL =
  'https://www.datocms.com/marketplace/plugins/i/datocms-plugin-web-previews';

/** The docs link of each field that needs one, under the field */
export const DOCS = {
  previewLinksEndpoint: {
    label: 'How to build the endpoint',
    to: `${MARKETPLACE_URL}#the-preview-links-api-endpoint`,
  },
  draftModeRoute: {
    label: 'How to build the draft mode route',
    to: `${MARKETPLACE_URL}#the-enable-draft-mode-route`,
  },
  visualEditing: {
    label: 'About Visual Editing',
    to: 'https://www.datocms.com/docs/visual-editing',
  },
  allowAttribute: {
    label: 'About the allow attribute',
    to: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#allow',
  },
};

/** What a website that blocks framing must allow, for the iframe section */
export const CSP_DOCS_URL = `${MARKETPLACE_URL}#content-security-policy`;
