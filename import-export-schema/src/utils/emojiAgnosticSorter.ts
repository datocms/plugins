import emojiRegexText from 'emoji-regex';

const emojiRegexp = emojiRegexText();

const formatRegexp = new RegExp(
  `^(${emojiRegexp.source})\\s*(.*)$`,
  emojiRegexp.flags.replace('g', ''),
);

export function splitRepresentativeEmojiAndLabel(
  text: string,
): [string | undefined, string] {
  const matches = text.match(formatRegexp);

  if (matches && matches.length === 3) {
    return [matches[1], matches[2]];
  }

  return [undefined, text];
}

export function getRepresentativeEmoji(text: string) {
  return splitRepresentativeEmojiAndLabel(text)[0];
}

export function getTextWithoutRepresentativeEmojiAndPadding(text: string) {
  return splitRepresentativeEmojiAndLabel(text)[1];
}

export function emojiAgnosticLocaleCompare(entityA: string, entityB: string) {
  const a = getTextWithoutRepresentativeEmojiAndPadding(entityA);
  const b = getTextWithoutRepresentativeEmojiAndPadding(entityB);

  return a.localeCompare(b);
}
