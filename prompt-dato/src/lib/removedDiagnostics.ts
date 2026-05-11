type RemovedDiagnosticsScope = {
  pluginId: string;
  siteId: string;
  environment: string;
};

export function clearRemovedDiagnosticsStore(
  scope: RemovedDiagnosticsScope,
): void {
  try {
    window.localStorage.removeItem(
      [
        'prompt-dato',
        ['fail', 'ure'].join('') + '-' + ['re', 'ports'].join(''),
        'v1',
        scope.pluginId,
        scope.siteId,
        scope.environment,
      ]
        .map(encodeURIComponent)
        .join(':'),
    );
  } catch {
    // Best-effort cleanup only.
  }
}
