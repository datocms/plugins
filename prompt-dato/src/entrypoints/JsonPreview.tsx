import s from './styles.module.css';

type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punctuation';

type JsonToken = {
  text: string;
  kind?: JsonTokenKind;
};

const JSON_TOKEN_PATTERN =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|[{}[\],:]/g;

const tokenClassNames: Record<JsonTokenKind, string> = {
  key: s.jsonTokenKey,
  string: s.jsonTokenString,
  number: s.jsonTokenNumber,
  literal: s.jsonTokenLiteral,
  punctuation: s.jsonTokenPunctuation,
};

type JsonPreviewProps = {
  value: unknown;
  className?: string;
};

export function JsonPreview({ value, className }: JsonPreviewProps) {
  const formatted = formatJson(stringifyPreviewValue(value));
  const tokens = formatted.valid ? tokenizeJson(formatted.text) : null;

  return (
    <pre className={className}>
      <code className={s.jsonPreviewCode}>
        {tokens
          ? tokens.map((token, index) => renderToken(token, index))
          : formatted.text}
      </code>
    </pre>
  );
}

function stringifyPreviewValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';

  try {
    const json = JSON.stringify(value, null, 2);
    return typeof json === 'string' ? json : String(value);
  } catch {
    return String(value);
  }
}

function formatJson(value: string): { text: string; valid: boolean } {
  try {
    return { text: JSON.stringify(JSON.parse(value), null, 2), valid: true };
  } catch {
    return { text: value.trim(), valid: false };
  }
}

function tokenizeJson(value: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let cursor = 0;

  for (const match of value.matchAll(JSON_TOKEN_PATTERN)) {
    const index = match.index;
    if (index === undefined) continue;

    if (index > cursor) {
      tokens.push({ text: value.slice(cursor, index) });
    }

    if (match[1]) {
      tokens.push({ text: match[1], kind: match[2] ? 'key' : 'string' });
      if (match[2]) {
        tokens.push({ text: match[2], kind: 'punctuation' });
      }
    } else if (match[3]) {
      tokens.push({ text: match[3], kind: 'number' });
    } else if (match[4]) {
      tokens.push({ text: match[4], kind: 'literal' });
    } else {
      tokens.push({ text: match[0], kind: 'punctuation' });
    }

    cursor = index + match[0].length;
  }

  if (cursor < value.length) {
    tokens.push({ text: value.slice(cursor) });
  }

  return tokens;
}

function renderToken(token: JsonToken, index: number) {
  if (!token.kind) {
    return token.text;
  }

  return (
    <span className={tokenClassNames[token.kind]} key={`${token.kind}-${index}`}>
      {token.text}
    </span>
  );
}
