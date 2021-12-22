import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import get from 'lodash-es/get';
import { Product } from '../utils/CommerceLayerClient';
import { Canvas } from 'datocms-react-ui';
import Value from '../components/Value';
import Empty from '../components/Empty';

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

export default function Main({ ctx }: PropTypes) {
  const value = get(ctx.formValues, ctx.fieldPath) as string | null;

  const handleSelect = (product: Product) => {
    ctx.setFieldValue(ctx.fieldPath, product.attributes.code);
  };

  const handleReset = () => {
    ctx.setFieldValue(ctx.fieldPath, null);
  };

  return (
    <Canvas ctx={ctx}>
      {value ? (
        <Value value={value} onReset={handleReset} />
      ) : (
        <Empty onSelect={handleSelect} />
      )}
    </Canvas>
  );
}
