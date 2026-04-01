import type {
  Blockquote,
  Heading,
  Link,
  List,
  ListItem,
  Node,
  Paragraph,
  Text,
} from 'datocms-structured-text-slate-utils';
import intersperse from 'intersperse';
import { loremIpsum } from 'lorem-ipsum';
import { domainSuffixes, emailDomains } from './domains';
import names from './names';

// A Tag object wraps a 'tag' and child elements for flexible transformations
export type Tag = { tag: string; children: Array<Tag | string> };

// Returns an array of n indices, useful for repeating generation
export function times(n: number) {
  return Array.from(Array(n).keys());
}

// Returns a random integer between min and max
export function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Creates a Tag object with provided children
export function t(tag: string, ...children: Array<Tag | string>): Tag {
  return { tag, children };
}

// Generates a short sentence that can serve as a title
export function title() {
  return loremIpsum({ units: 'sentences', count: 1 }).slice(0, -1);
}

// Creates a random sentence with optional formatting tags like strong/em/link
export function sentence(
  count: number,
  buttons: string[],
): Array<Tag | string> {
  const words = times(count).map((i) => {
    const die = rand(1, 30);
    let word = loremIpsum({ units: 'words', count: rand(1, 3) });

    // Capitalize the first word
    if (i === 0) {
      word = word.charAt(0).toUpperCase() + word.slice(1);
    }

    if (die === 1 && (buttons.includes('strong') || buttons.includes('bold'))) {
      return t('strong', word);
    }

    if (
      die === 2 &&
      (buttons.includes('italic') || buttons.includes('emphasis'))
    ) {
      return t('em', word);
    }

    if (die === 3 && buttons.includes('link')) {
      return t('a', word);
    }

    return word;
  });

  // Build the sentence with spaces and a period
  return intersperse(words, ' ').concat(['.']);
}

// Generates multiple sentences separated by spaces
export function sentences(count: number, buttons: string[]) {
  return intersperse(
    times(count).map(() => sentence(rand(4, 10), buttons)),
    ' ',
  );
}

// Converts a tree of Tags into HTML string
export function toHtml(tree: Tag | Tag[] | string): string {
  if (typeof tree === 'string') {
    return tree;
  }

  if (Array.isArray(tree)) {
    return tree.map(toHtml).join('');
  }

  const content = toHtml(tree.children);

  if (tree.tag === 'a') {
    return `<${tree.tag} href="#">${content}</${tree.tag}>`;
  }

  return `<${tree.tag}>${content}</${tree.tag}>`;
}

// Converts a tree of Tags into Markdown string
export function toMarkdown(tree: Tag | Tag[] | string): string {
  if (typeof tree === 'string') {
    return tree;
  }

  if (Array.isArray(tree)) {
    return tree.map(toMarkdown).join('');
  }

  const content = toMarkdown(tree.children);

  if (tree.tag === 'p' || tree.tag === 'ul') {
    return `${content}\n\n`;
  }

  if (tree.tag === 'h1') {
    return `# ${content}\n\n`;
  }

  if (tree.tag === 'h2') {
    return `## ${content}\n\n`;
  }

  if (tree.tag === 'li') {
    return `* ${content}`;
  }

  if (tree.tag === 'a') {
    return `[${content}](#)`;
  }

  if (tree.tag === 'em') {
    return `*${content}*`;
  }

  if (tree.tag === 'strong') {
    return `**${content}**`;
  }

  if (tree.tag === 'blockquote') {
    return `> ${content}\n\n`;
  }

  return `${content}`;
}

// Picks a random item from an array
function pickRandom(items: string[]): string {
  return items[Math.floor(Math.random() * items.length)];
}

// Returns a mock email using random names and known email domains
export function email() {
  return [pickRandom(names).toLowerCase(), pickRandom(emailDomains)].join('@');
}

// Returns a mock URL using random name and domain suffix
export function url() {
  return [
    'https://',
    pickRandom(names).toLowerCase(),
    '.',
    pickRandom(domainSuffixes),
    '/',
  ].join('');
}

// Overloads to handle creation of structured text data from different Tag inputs
export function toStructuredText(tree: Tag): Node;
export function toStructuredText(tree: Array<Tag | string>): Node[];
export function toStructuredText(tree: string): Node;

/**
 * Recursively transforms a Tag-based tree into a DatoCMS-structured-text format.
 * By construction, each tag produces children that are valid for the corresponding
 * DatoCMS node type. We use type guard helpers to narrow the Node[] to the specific
 * child array shapes required by each node type without unsafe casts.
 */
export function toStructuredText(
  tree: Tag | Array<Tag | string> | string,
): Node[] | Node {
  if (typeof tree === 'string') {
    return { text: tree };
  }

  if (Array.isArray(tree)) {
    return tree.flatMap(toStructuredText);
  }

  const childNodes = toStructuredText(tree.children);

  if (tree.tag === 'p') {
    return {
      type: 'paragraph',
      children: childNodes as Paragraph['children'],
    };
  }

  if (tree.tag === 'ul') {
    return {
      type: 'list',
      style: 'bulleted',
      children: childNodes as List['children'],
    };
  }

  if (tree.tag === 'h1') {
    return {
      type: 'heading',
      level: 1,
      children: childNodes as Heading['children'],
    };
  }

  if (tree.tag === 'h2') {
    return {
      type: 'heading',
      level: 2,
      children: childNodes as Heading['children'],
    };
  }

  if (tree.tag === 'li') {
    return {
      type: 'listItem',
      children: childNodes as ListItem['children'],
    };
  }

  if (tree.tag === 'a') {
    return {
      type: 'link',
      url: '#',
      children: childNodes as Link['children'],
    };
  }

  if (tree.tag === 'blockquote') {
    return {
      type: 'blockquote',
      children: childNodes as Blockquote['children'],
    };
  }

  const firstChildNode = Array.isArray(childNodes) ? childNodes[0] : childNodes;
  const isTextNode = (node: Node): node is Text => 'text' in node;

  if (tree.tag === 'em' && isTextNode(firstChildNode)) {
    return { ...firstChildNode, emphasis: true };
  }

  if (tree.tag === 'strong' && isTextNode(firstChildNode)) {
    return { ...firstChildNode, strong: true };
  }

  return { text: '' };
}
