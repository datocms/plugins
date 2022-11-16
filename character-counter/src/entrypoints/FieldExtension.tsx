import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { get } from 'lodash-es';
import { Node, isText } from 'datocms-structured-text-slate-utils';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

function visit<X extends Node>(
  nodes: Node[],
  test: (x: Node) => x is X,
  callback: (node: X) => void,
): void {
  nodes.forEach((node) => {
    if (test(node)) {
      callback(node);
    }

    if ('children' in node) {
      visit(node.children as any as Node[], test, callback);
    }
  });
}

function getCharCount(value: unknown, fieldType: string) {
  if (['string', 'text'].includes(fieldType)) {
    return (value as null | string)?.length || 0;
  }

  if (fieldType === 'structured_text') {
    if (!value) {
      return 0;
    }

    let counter = 0;

    visit(value as Node[], isText, (textNode) => {
      counter += textNode.text.length;
    });

    return counter;
  }

  throw new Error('This should not happen');
}

export default function FieldExtension({ ctx }: Props) {
  const charCount = getCharCount(
    get(ctx.formValues, ctx.fieldPath),
    ctx.field.attributes.field_type,
  );

  return (
    <Canvas ctx={ctx}>
      {charCount > 0 && (
        <div className={s.wrapper}>Character count: {charCount}</div>
      )}
    </Canvas>
  );
}
