export function getFormatFromPath(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.split('?')[0]?.split('#')[0];
  if (!cleaned) return null;
  const parts = cleaned.split('.');
  if (parts.length < 2) return null;
  const ext = parts[parts.length - 1]?.trim().toLowerCase();
  return ext || null;
}

export function normalizeFormat(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

export function resolveFormat({
  format,
  url,
  filename,
}: {
  format?: string | null;
  url?: string | null;
  filename?: string | null;
}): string | null {
  return (
    normalizeFormat(format) ||
    getFormatFromPath(url) ||
    getFormatFromPath(filename)
  );
}

export function isImageFormat(value?: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  if (normalized.startsWith('image/')) return true;
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'].includes(
    normalized
  );
}

export function getFormatLabel(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.startsWith('image/')) {
    const [, subtype] = normalized.split('/');
    return subtype || normalized;
  }
  return normalized;
}
