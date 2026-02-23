type NormalizePathArgs = {
  path: string | null | undefined;
  draftModeUrl: string;
  fallbackPath?: string;
};

function toSafePath(
  path: string | null | undefined,
  allowedOrigin: string,
): string | undefined {
  if (!path) {
    return undefined;
  }

  try {
    const parsed = new URL(path, allowedOrigin);

    if (parsed.origin !== allowedOrigin) {
      return undefined;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
  } catch {
    return undefined;
  }
}

export function normalizePathForVisualEditing({
  path,
  draftModeUrl,
  fallbackPath = '/',
}: NormalizePathArgs): string {
  // Keep only same-origin navigations and always emit a path-like value.
  const allowedOrigin = new URL(draftModeUrl).origin;

  return (
    toSafePath(path, allowedOrigin) ??
    toSafePath(fallbackPath, allowedOrigin) ??
    '/'
  );
}
