import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Markdown.module.css';

export type MarkdownProps = {
  className?: string;
  content: string;
};

/** The height of a block of code before it scrolls, in CSS pixels */
const CODE_BLOCK_MAX_HEIGHT = 320;

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

/** A node of the syntax tree that react-markdown renders */
type TreeNode = {
  type: string;
  value?: unknown;
  children?: readonly TreeNode[];
};

/** The text of a node and of all its children */
function textOf(node: TreeNode): string {
  if (typeof node.value === 'string') {
    return node.value;
  }

  return (node.children ?? []).map(textOf).join('');
}

/** A node of the Markdown tree, before it becomes HTML */
type MarkdownNode = {
  type: string;
  depth?: number;
  children?: MarkdownNode[];
};

function headingsOf(node: MarkdownNode): MarkdownNode[] {
  const children = (node.children ?? []).flatMap(headingsOf);

  return node.type === 'heading' ? [node, ...children] : children;
}

/**
 * The depths of the headings of a response are made contiguous: its
 * shallowest heading becomes the first level and each deeper depth the next
 * one, whatever depths the Markdown uses ("### Details" alone is the first
 * level, which looks larger).
 */
function remarkContiguousHeadings() {
  return (tree: MarkdownNode) => {
    const headings = headingsOf(tree);
    const depths = [
      ...new Set(headings.map((heading) => heading.depth ?? 1)),
    ].sort((a, b) => a - b);

    for (const heading of headings) {
      heading.depth = depths.indexOf(heading.depth ?? 1) + 1;
    }
  };
}

/** An element of the HTML tree, after the Markdown becomes HTML */
type HtmlNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
};

function codeBlocksOf(node: HtmlNode): HtmlNode[] {
  const children = (node.children ?? []).flatMap(codeBlocksOf);

  return node.type === 'element' && node.tagName === 'pre'
    ? [node, ...children]
    : children;
}

/** The language of a fence ("```ts"), from the class of its code element */
function codeBlockLanguage(block: HtmlNode): string | undefined {
  const code = block.children?.find(
    (child) => child.type === 'element' && child.tagName === 'code',
  );
  const classNames = code?.properties?.className;
  const languageClass = (Array.isArray(classNames) ? classNames : [])
    .map(String)
    .find((className) => className.startsWith('language-'));

  return languageClass?.slice('language-'.length) || undefined;
}

const LANGUAGE_NAMES: Record<string, string> = {
  bash: 'Shell',
  css: 'CSS',
  diff: 'Diff',
  gql: 'GraphQL',
  graphql: 'GraphQL',
  html: 'HTML',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  markdown: 'Markdown',
  md: 'Markdown',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  ruby: 'Ruby',
  sh: 'Shell',
  shell: 'Shell',
  sql: 'SQL',
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
  zsh: 'Shell',
};

/**
 * The name of a block of code, which is a region: its language, and its
 * position when the response has more than one block, so that the regions
 * of a response have different names ("TypeScript code, block 2").
 */
function codeBlockName(
  language: string | undefined,
  index: number,
  total: number,
): string {
  const languageName =
    language && (LANGUAGE_NAMES[language.toLowerCase()] ?? language);
  const name = languageName ? `${languageName} code` : 'Code';

  if (total <= 1) {
    return name;
  }

  return languageName
    ? `${name}, block ${index + 1}`
    : `Code block ${index + 1}`;
}

/** Each block of code gets its name, read by the `pre` component */
function rehypeCodeBlockNames() {
  return (tree: HtmlNode) => {
    const blocks = codeBlocksOf(tree);

    for (const [index, block] of blocks.entries()) {
      block.properties = {
        ...block.properties,
        dataCodeName: codeBlockName(
          codeBlockLanguage(block),
          index,
          blocks.length,
        ),
      };
    }
  };
}

/**
 * A Markdown heading as a bold block of the text, not as a heading: only a
 * page or a dialog holds headings, and the agent's frame is a sidebar or an
 * inspector. The first level of a response is larger.
 */
function markdownHeading(large = false) {
  const className = large
    ? `${styles.heading} ${styles.headingLarge}`
    : styles.heading;

  return ({ children }: { children?: ReactNode }) => (
    <div className={className}>{children}</div>
  );
}

const COMPONENTS: Components = {
  h1: markdownHeading(true),
  h2: markdownHeading(),
  h3: markdownHeading(),
  h4: markdownHeading(),
  h5: markdownHeading(),
  h6: markdownHeading(),
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
  // A wide table scrolls in its own box, and stays a table
  table: ({ children, node }) => {
    void node;

    return (
      <div className={styles.tableScroll}>
        <table>{children}</table>
      </div>
    );
  },
  // A block of code is a code snippet, with its copy button. The trailing
  // newline of the block is not part of the code.
  pre: ({ children, node }) => {
    if (!node) {
      return <pre>{children}</pre>;
    }

    const name = node.properties?.dataCodeName;

    return (
      <div className={styles.codeBlock}>
        <CodeSnippet
          ariaLabel={typeof name === 'string' ? name : 'Code'}
          code={textOf(node).replace(/\n$/, '')}
          maxHeight={CODE_BLOCK_MAX_HEIGHT}
        />
      </div>
    );
  },
};

const REMARK_PLUGINS = [remarkGfm, remarkContiguousHeadings];
const REHYPE_PLUGINS = [rehypeCodeBlockNames];

/**
 * The Markdown of a response, as safe content: no HTML, links that open in
 * a new tab, and remote images as links (the frame never loads them).
 */
export function Markdown({ className, content }: MarkdownProps) {
  const rootClassName = className ? `${styles.root} ${className}` : styles.root;

  return (
    <div className={rootClassName}>
      <ReactMarkdown
        components={COMPONENTS}
        rehypePlugins={REHYPE_PLUGINS}
        remarkPlugins={REMARK_PLUGINS}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
