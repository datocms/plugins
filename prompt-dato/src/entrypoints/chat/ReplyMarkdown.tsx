import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import Pill from 'datocms-react-ui/Pill';
import { memo, type ReactNode, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FieldInfo } from '../../lib/recordContext';
import { AtIcon } from '../icons';
import {
  type FieldNavigationTarget,
  fieldUrlTransform,
  parseFieldHref,
} from './fieldLinks';
import { InlineCode } from './InlineCode';
import s from './ReplyMarkdown.module.css';

/** The height of a block of code before it scrolls, in CSS pixels */
const CODE_BLOCK_MAX_HEIGHT = 320;

/** The property that holds the position of a block of code in its reply */
const CODE_BLOCK_NUMBER = 'dataCodeBlockNumber';

/** A node of the syntax tree that react-markdown renders */
type TreeNode = {
  type: string;
  tagName?: string;
  value?: unknown;
  properties?: Record<string, unknown>;
  children?: readonly TreeNode[];
};

/** The text of a node and of all its children */
function textOf(node: TreeNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(textOf).join('');
}

/**
 * Numbers the blocks of code of a reply in their order, so that each code
 * snippet gets a name of its own
 */
function rehypeNumberCodeBlocks() {
  return (tree: TreeNode) => {
    let count = 0;
    const visit = (node: TreeNode) => {
      if (node.type === 'element' && node.tagName === 'pre') {
        count += 1;
        node.properties = { ...node.properties, [CODE_BLOCK_NUMBER]: count };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeNumberCodeBlocks];

/** The language of the fence of a block of code ("json"), when it has one */
function codeLanguage(pre: TreeNode): string | null {
  const code = pre.children?.find((child) => child.tagName === 'code');
  const classes = code?.properties?.className;
  if (!Array.isArray(classes)) return null;

  for (const name of classes) {
    if (typeof name === 'string' && name.startsWith('language-')) {
      return name.slice('language-'.length) || null;
    }
  }
  return null;
}

/**
 * The name of the region of a block of code. The transcript can hold many of
 * them, so the name tells the reply and the place in it: "Code 2 of reply 3,
 * in json".
 */
function codeBlockName(replyNumber: number, pre: TreeNode): string {
  const number = pre.properties?.[CODE_BLOCK_NUMBER];
  const name = `Code ${typeof number === 'number' ? number : 1} of reply ${replyNumber}`;
  const language = codeLanguage(pre);
  return language ? `${name}, in ${language}` : name;
}

/**
 * A Markdown heading of a reply is bold text, not a heading: the sidebar has
 * no main content or dialog for a heading to belong to.
 */
function HeadingText({ children }: { children?: ReactNode }) {
  return <p className={s.heading}>{children}</p>;
}

/**
 * A table that cannot fit, even with its cells wrapped, scrolls by itself.
 * The box scrolls, not the table: a table with another display loses its
 * rows and cells for some screen readers.
 */
function ScrollingTable({ children }: { children?: ReactNode }) {
  return (
    <div className={s.tableScroll}>
      <table>{children}</table>
    </div>
  );
}

const STATIC_COMPONENTS: Components = {
  h1: HeadingText,
  h2: HeadingText,
  h3: HeadingText,
  h4: HeadingText,
  h5: HeadingText,
  h6: HeadingText,
  table: ScrollingTable,
  // Blocks of code render as code snippets (see `pre` below), thus every
  // other `code` is inline
  code: InlineCode,
};

/**
 * The tooltip of a field link, with the name of the field as the form shows
 * it: "Go to Excerpt · EN". A nested path names its field.
 */
function fieldLinkTooltip(
  target: FieldNavigationTarget,
  fields: FieldInfo[],
): string {
  const [apiKey] = target.fieldPath.split('.');
  const field = fields.find((candidate) => candidate.apiKey === apiKey);
  if (!field) return 'Go to the field';
  const locale = target.locale ? ` · ${target.locale.toUpperCase()}` : '';
  return `Go to ${field.label}${locale}`;
}

type FieldLinkProps = {
  target: FieldNavigationTarget;
  children?: ReactNode;
  fields: FieldInfo[];
  /** The CMS path of the form of the record, or null without a record */
  recordEditPath: string | null;
  onScrollToField: (target: FieldNavigationTarget) => void;
};

/**
 * A `field:` link: a tag that goes to the field in the form of the record.
 * A field that is not localized is a CMS link, thus a middle click opens it
 * in a new tab. A localized field first switches the form to its locale,
 * which only an action can do.
 */
function FieldLink({
  target,
  children,
  fields,
  recordEditPath,
  onScrollToField,
}: FieldLinkProps) {
  const content = (
    <>
      {children}
      {target.locale ? ` · ${target.locale.toUpperCase()}` : null}
    </>
  );
  const tooltip = fieldLinkTooltip(target, fields);

  if (!target.localized && recordEditPath) {
    return (
      <Pill
        tone="soft"
        icon={<AtIcon />}
        tooltip={tooltip}
        to={`${recordEditPath}#fieldPath=${target.fieldPath}`}
      >
        {content}
      </Pill>
    );
  }

  return (
    <Pill
      tone="soft"
      icon={<AtIcon />}
      tooltip={tooltip}
      onClick={() => onScrollToField(target)}
    >
      {content}
    </Pill>
  );
}

type Props = {
  text: string;
  /** The position of the reply in the chat, from 1, for the names of its code */
  replyNumber: number;
  fields: FieldInfo[];
  locales: string[];
  /** The CMS path of the form of the record, or null without a record */
  recordEditPath: string | null;
  onScrollToField: (target: FieldNavigationTarget) => void;
};

/**
 * The text of a reply, as GitHub-flavored Markdown. Links to fields of the
 * record (`field:title.en`) go to the field, and the other links open in a
 * new tab.
 */
export const ReplyMarkdown = memo(function ReplyMarkdown({
  text,
  replyNumber,
  fields,
  locales,
  recordEditPath,
  onScrollToField,
}: Props) {
  const components = useMemo<Components>(
    () => ({
      ...STATIC_COMPONENTS,
      // A block of code is a code snippet, with its copy button. The trailing
      // newline of the block is not part of the code.
      pre: ({ node, children }) => {
        if (!node) return <pre>{children}</pre>;

        return (
          <div className={s.codeBlock}>
            <CodeSnippet
              ariaLabel={codeBlockName(replyNumber, node)}
              code={textOf(node).replace(/\n$/, '')}
              maxHeight={CODE_BLOCK_MAX_HEIGHT}
            />
          </div>
        );
      },
      a: ({ children, href, title }) => {
        if (typeof href === 'string' && href.startsWith('field:')) {
          const target = parseFieldHref(href, fields, locales);
          if (!target) return <span>{children}</span>;

          return (
            <FieldLink
              target={target}
              fields={fields}
              recordEditPath={recordEditPath}
              onScrollToField={onScrollToField}
            >
              {children}
            </FieldLink>
          );
        }

        return (
          <a
            href={href}
            title={title}
            target="_blank"
            rel="noreferrer noopener"
          >
            {children}
          </a>
        );
      },
    }),
    [replyNumber, fields, locales, recordEditPath, onScrollToField],
  );

  return (
    <div className={s.root}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={fieldUrlTransform}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
