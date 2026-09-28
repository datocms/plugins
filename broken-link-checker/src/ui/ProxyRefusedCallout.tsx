/**
 * Shown once for the whole report when the link checking service refused the
 * plugin's address: a setup problem, not a problem with the links.
 */
export function ProxyRefusedCallout({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div
      className={`dl-callout dl-callout--warning${compact ? ' blc-callout--compact' : ''}`}
      role="note"
    >
      <p>
        No link could be checked: the link checking service only accepts this
        plugin when it's installed from the marketplace or run on localhost.
      </p>
    </div>
  );
}
