/** Resolves ctx.cssDesignTokens the way the host does, in a separate document. */
export function resolveDesignTokens(
  tokensCss: string,
  scheme: 'light' | 'dark',
): Record<string, string> {
  const names = [
    ...new Set(tokensCss.match(/--(?:color|shadow)--[\w-]+(?=\s*:)/g) ?? []),
  ].filter((name) => !name.startsWith('--color--navbar'));

  const probe = document.createElement('iframe');
  probe.style.display = 'none';
  document.body.append(probe);
  const doc = probe.contentDocument;
  const win = probe.contentWindow;
  if (!doc || !win) throw new Error('No probe document');
  doc.open();
  doc.write(
    `<!doctype html><html data-color-scheme="${scheme}"><head><style>${tokensCss}</style></head></html>`,
  );
  doc.close();

  const computed = win.getComputedStyle(doc.documentElement);
  const tokens = Object.fromEntries(
    names.map((name) => [name, computed.getPropertyValue(name).trim()]),
  );
  probe.remove();
  return tokens;
}
