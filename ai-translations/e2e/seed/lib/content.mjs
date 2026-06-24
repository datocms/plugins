/**
 * Pure content-shape helpers for building DatoCMS field values.
 * No IDs / client needed — block builders live in 3-records.mjs where refs exist.
 */

// --- DAST (structured text) --------------------------------------------------
export const span = (value, marks) => ({ type: 'span', value, ...(marks ? { marks } : {}) });
export const para = (...children) => ({ type: 'paragraph', children });
export const heading = (level, ...children) => ({ type: 'heading', level, children });
export const link = (url, text, meta) => ({
  type: 'link', url, children: [span(text)], ...(meta ? { meta } : {}),
});
export const bulleted = (...items) => ({
  type: 'list', style: 'bulleted',
  children: items.map((nodes) => ({ type: 'listItem', children: [para(...nodes)] })),
});
export const numbered = (...items) => ({
  type: 'list', style: 'numbered',
  children: items.map((nodes) => ({ type: 'listItem', children: [para(...nodes)] })),
});
export const quoteNode = (...paras) => ({ type: 'blockquote', children: paras });
/** Root-level embedded block node: pass a buildBlockRecord(...) result. */
export const blockNode = (item) => ({ type: 'block', item });
/** Wrap children into a complete DAST value. */
export const dast = (...children) => ({ schema: 'dast', document: { type: 'root', children } });

// --- scalar field values -----------------------------------------------------
/** File / gallery item value with field-level alt+title (so translation has content). */
export const fileVal = (uploadId, alt, title) => ({
  upload_id: uploadId, alt, title, custom_data: {}, focal_point: null,
});
/** SEO field value. */
export const seoVal = (title, description, image = null) => ({
  title, description, image, twitter_card: null, no_index: false,
});
/** JSON field stores a stringified payload. */
export const jsonVal = (obj) => JSON.stringify(obj);

/** Compose a localized field value: loc({ en: ..., it: ... }) -> same object (semantic marker). */
export const loc = (perLocale) => perLocale;
