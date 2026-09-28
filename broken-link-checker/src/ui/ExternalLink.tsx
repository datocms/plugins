import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
import { BreakableUrl } from './BreakableUrl';
import { Icon } from './Icon';

/** Only absolute web addresses open: never `javascript:`, `data:` or a relative path. */
export function isOpenableUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A URL from the content, opened in a new tab. Anything that isn't an
 * absolute http(s) address stays plain text.
 */
export function ExternalLink({ url }: { url: string }) {
  if (!isOpenableUrl(url)) return <BreakableUrl url={url} />;
  return (
    <a
      className="blc-external"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${url} (opens in a new tab)`}
    >
      <BreakableUrl url={url} />
      <Icon icon={faArrowUpRightFromSquare} />
    </a>
  );
}
