export type FieldType = 'json' | 'string';

export function isValidJson(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/**
 * Reads the tags out of the value of the field. Throws when the value has a
 * shape that the editor can't read.
 */
export function deserialize(value: unknown, fieldType: FieldType): string[] {
  if (!value) {
    return [];
  }

  if (fieldType === 'json') {
    const parsed = JSON.parse(String(value));

    if (!isValidJson(parsed)) {
      throw new Error('Incompatible value!');
    }

    return parsed;
  }

  if (typeof value === 'string') {
    return value.trim().split(/\s*,\s*/);
  }

  throw new Error('Incompatible value!');
}

export function serialize(tags: string[], fieldType: FieldType): string {
  if (fieldType === 'json') {
    return JSON.stringify(tags);
  }

  return tags.join(', ');
}

function normalize(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * Appends the texts to the tags. Each text is trimmed; empty texts and texts
 * that match a tag, or an earlier text, case-insensitively, are skipped.
 */
export function mergeTags(existing: string[], texts: string[]): string[] {
  const seen = new Set(existing.map(normalize));
  const added: string[] = [];

  for (const text of texts) {
    const tag = text.trim();
    const key = tag.toLowerCase();

    if (!tag || seen.has(key)) {
      continue;
    }

    seen.add(key);
    added.push(tag);
  }

  return [...existing, ...added];
}
