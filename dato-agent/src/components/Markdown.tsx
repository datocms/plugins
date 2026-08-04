import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Markdown.module.css';

export type MarkdownProps = {
  className?: string;
  content: string;
};

const EXPLICIT_PROTOCOL = /^[a-z][a-z\d+.-]*:/i;

function safeLinkHref(value: string | undefined): string | undefined {
  const href = value?.trim();

  if (!href) {
    return undefined;
  }

  if (!EXPLICIT_PROTOCOL.test(href) && !href.startsWith('//')) {
    return href;
  }

  try {
    const url = new URL(href, 'https://plugin.invalid');

    return ['http:', 'https:', 'mailto:'].includes(url.protocol)
      ? href
      : undefined;
  } catch {
    return undefined;
  }
}

function safeRemoteImageHref(value: string | undefined): string | undefined {
  const href = value?.trim();

  if (!href) {
    return undefined;
  }

  try {
    const url = new URL(href);

    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function Markdown({ className, content }: MarkdownProps) {
  const rootClassName = className ? `${styles.root} ${className}` : styles.root;

  return (
    <div className={rootClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href, node, title }) => {
            void node;
            const safeHref = safeLinkHref(href);

            if (!safeHref) {
              return <span>{children}</span>;
            }

            return (
              <a
                href={safeHref}
                rel="noopener noreferrer"
                target="_blank"
                title={title}
              >
                {children}
              </a>
            );
          },
          img: ({ alt, node, src, title }) => {
            void node;
            const safeHref = safeRemoteImageHref(src);

            if (!safeHref) {
              return alt ? (
                <span className={styles.unavailableImage}>{alt}</span>
              ) : null;
            }

            return (
              <a
                className={styles.imageLink}
                href={safeHref}
                rel="noopener noreferrer"
                target="_blank"
                title={title}
              >
                {alt ? `Open image: ${alt}` : 'Open image'}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
