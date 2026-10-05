/**
 * Resolves `ctx.cssDesignTokens` the way the host does: it loads the tokens
 * file into a hidden, separate document whose `<html>` carries
 * `data-color-scheme`, then reads every `--color--*` and `--shadow--*` name
 * the file declares except `--color--navbar*` (dashboard-internal, never sent
 * to plugins). That's the 119 tokens the host sends. The preview frame never
 * loads the file itself, so it only gets tokens through ctx, as in DatoCMS,
 * and portals that escape `<Canvas>` show up unstyled just like in the
 * dashboard.
 */
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

  try {
    const doc = probe.contentDocument;
    const view = probe.contentWindow;
    if (!doc || !view) {
      throw new Error('The token probe frame has no document.');
    }

    doc.open();
    doc.write(
      `<!doctype html><html data-color-scheme="${scheme}"><head><style>${tokensCss}</style></head></html>`,
    );
    doc.close();

    const computed = view.getComputedStyle(doc.documentElement);
    return Object.fromEntries(
      names.map((name) => [name, computed.getPropertyValue(name).trim()]),
    );
  } finally {
    probe.remove();
  }
}
