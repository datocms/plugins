import { Field } from 'datocms-plugin-sdk';
import { Node } from 'datocms-structured-text-slate-utils';
import { loremIpsum } from 'lorem-ipsum';

import {
  t,
  title,
  times,
  sentences,
  toHtml,
  rand,
  email,
  url,
  toMarkdown,
  toStructuredText,
  Tag,
} from './text';

/**
 * Generates a simple article structure with optional headings, lists, and blockquotes
 * depending on which formatting buttons are available.
 */
function article(buttons: string[]) {
  const s = (count = rand(2, 4)) => sentences(count, buttons);

  const generateList =
    buttons.includes('unordered_list') || buttons.includes('list');

  const generateHeading =
    buttons.includes('heading') || buttons.includes('format');

  const generateBlockquote =
    buttons.includes('quote') || buttons.includes('blockquote');

  if (generateHeading) {
    return [
      t('h1', title()),
      t('h2', title()),
      times(rand(1, 2)).map(() => t('p', s())),
      generateList && t('h2', title()),
      generateList && t('p', s()),
      generateList &&
        t('ul', ...times(3).map(() => t('li', t('p', s(rand(1, 3)))))),
      generateBlockquote && t('h2', title()),
      generateBlockquote && t('p', s()),
      generateBlockquote && t('blockquote', s(4)),
    ].filter((x) => !!x) as Tag[];
  }

  return [
    times(rand(1, 2)).map(() => t('p', s())),
    generateList &&
      t('ul', ...times(3).map(() => t('li', t('p', s(rand(1, 3)))))),
    generateList && t('p', s()),
    generateBlockquote && t('blockquote', s(4)),
    generateBlockquote && t('p', s()),
  ].filter((x) => !!x) as Tag[];
}

/**
 * Generates dummy text based on the provided field's type and editor configuration.
 */
export default function generateDummyText(field: Field): string | Node[] {
  const { attributes } = field;

  // Check for single-line string with special formats
  if (attributes.field_type === 'string') {
    if (
      attributes.validators.format &&
      (attributes.validators.format as Record<string, string>)
        .predefined_pattern === 'email'
    ) {
      return email();
    }
    if (
      attributes.validators.format &&
      (attributes.validators.format as Record<string, string>)
        .predefined_pattern === 'url'
    ) {
      return url();
    }
    return title();
  }

  // Handle text fields with markdown
  if (attributes.appearance.editor === 'markdown') {
    return toMarkdown(
      article(attributes.appearance.parameters.toolbar as string[])
    );
  }

  // Handle text fields with wysiwyg
  if (attributes.appearance.editor === 'wysiwyg') {
    return toHtml(
      article(attributes.appearance.parameters.toolbar as string[])
    );
  }

  // Handle structured text
  if (attributes.appearance.editor === 'structured_text') {
    const result = toStructuredText(
      article([
        ...(attributes.appearance.parameters.nodes as string[]),
        ...(attributes.appearance.parameters.marks as string[]),
      ])
    );
    return result;
  }

  // Fallback to plain lorem ipsum for other cases
  return loremIpsum({ units: 'paragraphs', count: 3 });
}