import { ExternalLinkIcon } from '../icons';
import { BreakableUrl } from './BreakableUrl';
import styles from './ExternalLink.module.css';

/** Only absolute web addresses open: never `javascript:`, `data:` or a relative path. */
export function isOpenableUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

type ExternalLinkProps = {
  url: string;
  /**
   * The link is part of a sentence: it keeps the color of the text around
   * it, underlined. Without it, a URL on its own takes the link ink.
   */
  inText?: boolean;
};

/**
 * A URL from the content, opened in a new tab. Anything that isn't an
 * absolute http(s) address stays plain text.
 */
export function ExternalLink({ url, inText = false }: ExternalLinkProps) {
  if (!isOpenableUrl(url)) return <BreakableUrl url={url} />;
  return (
    <a
      className={inText ? styles.inText : styles.link}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${url} (opens in a new tab)`}
    >
      <BreakableUrl url={url} />
      {/* The icon stays on the URL's last line; its CSS adds no copied text. */}
      <span className={styles.tail}>
        <ExternalLinkIcon className={styles.icon} />
      </span>
    </a>
  );
}
