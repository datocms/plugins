import l from 'lorem-ipsum';
import intersperse from 'intersperse';
import names from './names';
import { emailDomains, domainSuffixes } from './domains';

export function times(n) {
  /* eslint-disable prefer-spread */
  return Array.apply(null, { length: n }).map(Number.call, Number);
}

export function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function t(tag, ...children) {
  return { tag, children };
}

export function title() {
  return l({ units: 'sentences', count: 1 }).slice(0, -1);
}

export function sentence(count, buttons) {
  const words = times(count).map((i) => {
    const die = rand(1, 30);
    let word = l({ units: 'words', count: rand(1, 3) });

    if (i === 0) {
      word = word.charAt(0).toUpperCase() + word.slice(1);
    }

    if (die === 1 && (buttons.includes('strong') || buttons.includes('bold'))) {
      return t('strong', word);
    }

    if (die === 2 && buttons.includes('italic')) {
      return t('em', word);
    }

    if (die === 3 && buttons.includes('link')) {
      return t('a', word);
    }

    return word;
  });

  return intersperse(words, ' ').concat(['.']);
}

export function sentences(count, buttons) {
  return intersperse(times(count).map(() => sentence(rand(4, 10), buttons)), ' ');
}

export function toHtml(tree) {
  if (Array.isArray(tree)) {
    return tree.map(toHtml).join('');
  }

  if (tree.tag) {
    const content = toHtml(tree.children);

    if (tree.tag === 'a') {
      return `<${tree.tag} href="#">${content}</${tree.tag}>`;
    }

    return `<${tree.tag}>${content}</${tree.tag}>`;
  }

  return tree;
}

export function toMarkdown(tree) {
  if (Array.isArray(tree)) {
    return tree.map(toMarkdown).join('');
  }

  if (tree.tag) {
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
  }

  return tree;
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function email() {
  return [pickRandom(names).toLowerCase(), pickRandom(emailDomains)].join('@');
}

export function url() {
  return ['https://', pickRandom(names).toLowerCase(), '.', pickRandom(domainSuffixes), '/'].join('');
}
