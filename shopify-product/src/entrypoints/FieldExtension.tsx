import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import Value from '../components/Value';
import Empty from '../components/Empty';
import { Product } from '../utils/ShopifyClient';
import get from 'lodash-es/get';

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

export default function FieldExtension({ ctx }: PropTypes) {
  const value = get(ctx.formValues, ctx.fieldPath) as string | null;

  const handleSelect = (product: Product) => {
    ctx.setFieldValue(ctx.fieldPath, product.handle);
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
