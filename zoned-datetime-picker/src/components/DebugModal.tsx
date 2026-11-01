import type { RenderModalCtx } from 'datocms-plugin-sdk';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';

/**
 * Simple modal that displays the raw JSON value for debugging.
 * Triggered from the field context menu
 */
export const DebugModal = ({ ctx }: { ctx: RenderModalCtx }) => {
  const { value } = ctx.parameters as { value?: unknown };
  const code =
    typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);

  return <CodeSnippet code={code} ariaLabel="JSON value" />;
};
