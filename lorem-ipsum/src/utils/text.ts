import { loremIpsum } from 'lorem-ipsum';
import intersperse from 'intersperse';
import names from './names';
import { emailDomains, domainSuffixes } from './domains';
import {
  Blockquote,
  Heading,
  Link,
  List,
  ListItem,
  Node,
  Paragraph,
  Text,
} from 'datocms-structured-text-slate-utils';

export type Tag = { tag: string; children: any[] };

export function times(n: number) {
  /* eslint-disable prefer-spread */
  return Array.from(Array(n).keys());
}

export function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function t(tag: string, ...children: any[]): Tag {
  return { tag, children };
}

export function title() {
  return loremIpsum({ units: 'sentences', count: 1 }).slice(0, -1);
}

export function sentence(
  count: number,
  buttons: string[],
): Array<Tag | string> {
  const words = times(count).map((i) => {
    const die = rand(1, 30);
    let word = loremIpsum({ units: 'words', count: rand(1, 3) });

    if (i === 0) {
      word = word.charAt(0).toUpperCase() + word.slice(1);
    }

    if (die === 1 && (buttons.includes('strong') || buttons.includes('bold'))) {
      return t('strong', word);
    }

    if (die === 2 && (buttons.includes('italic') || buttons.includes('emphasis'))) {
      return t('em', word);
    }

    if (die === 3 && buttons.includes('link')) {
      return t('a', word);
    }

    return word;
  });

  return intersperse(words, ' ').concat(['.']);
}

export function sentences(count: number, buttons: string[]) {
  return intersperse(
    times(count).map(() => sentence(rand(4, 10), buttons)),
    ' ',
  );
}

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

function pickRandom(items: string[]): string {
  return items[Math.floor(Math.random() * items.length)];
}

export function email() {
  return [pickRandom(names).toLowerCase(), pickRandom(emailDomains)].join('@');
}

export function url() {
  return [
    'https://',
    pickRandom(names).toLowerCase(),
    '.',
    pickRandom(domainSuffixes),
    '/',
  ].join('');
}

export function toStructuredText(tree: Tag): Node;
export function toStructuredText(tree: Tag[]): Node[];
export function toStructuredText(tree: string): Node;

export function toStructuredText(tree: Tag | Tag[] | string): Node[] | Node {
  if (typeof tree === 'string') {
    return { text: tree };
  }

  if (Array.isArray(tree)) {
    return tree.map(toStructuredText).flat();
  }

  const content = toStructuredText(tree.children);

  if (tree.tag === 'p') {
    return {
      type: 'paragraph',
      children: content as any as Paragraph['children'],
    };
  }

  if (tree.tag === 'ul') {
    return {
      type: 'list',
      style: 'bulleted',
      children: content as any as List['children'],
    };
  }

  if (tree.tag === 'h1') {
    return {
      type: 'heading',
      level: 1,
      children: content as any as Heading['children'],
    };
  }

  if (tree.tag === 'h2') {
    return {
      type: 'heading',
      level: 2,
      children: content as any as Heading['children'],
    };
  }

  if (tree.tag === 'li') {
    return {
      type: 'listItem',
      children: content as any as ListItem['children'],
    };
  }

  if (tree.tag === 'a') {
    return {
      type: 'link',
      url: '#',
      children: content as any as Link['children'],
    };
  }

  if (tree.tag === 'blockquote') {
    return {
      type: 'blockquote',
      children: content as any as Blockquote['children'],
    };
  }

  if (tree.tag === 'em') {
    const textNode = content[0] as any as Text;
    return { ...textNode, emphasis: true };
  }

  if (tree.tag === 'strong') {
    const textNode = content[0] as any as Text;
    return { ...textNode, strong: true };
  }

  return { text: '' };
}
