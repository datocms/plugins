import { RenderModalCtx } from 'datocms-plugin-sdk';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button, TextInput, Canvas, Spinner } from 'datocms-react-ui';
import s from './styles.module.css';
import CommerceLayerClient, { Product } from '../../utils/CommerceLayerClient';
import useStore, { State } from '../../utils/useStore';
import { normalizeConfig } from '../../types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch } from '@fortawesome/free-solid-svg-icons';
import classNames from 'classnames';

const currentSearchSelector = (state: State) => state.getCurrentSearch();
const currentFetchProductsMatchingSelector = (state: State) =>
  state.fetchProductsMatching;

export default function BrowseProductsModal({ ctx }: { ctx: RenderModalCtx }) {
  const performSearch = useStore(currentFetchProductsMatchingSelector);
  const { query, status, products } = useStore(currentSearchSelector);

  const [sku, setSku] = useState<string>('');

  const { baseEndpoint, clientId } = normalizeConfig(
    ctx.plugin.attributes.parameters,
  );

  const client = useMemo(() => {
    return new CommerceLayerClient({ baseEndpoint, clientId });
  }, [baseEndpoint, clientId]);

  useEffect(() => {
    performSearch(client, query);
  }, [performSearch, query, client]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    performSearch(client, sku);
  };

  return (
    <Canvas ctx={ctx}>
      <div className={s['browse']}>
        <form className={s['search']} onSubmit={handleSubmit}>
          <TextInput
            placeholder="Search products... (ie. mens shirts)"
            id="sku"
            name="sku"
            value={sku}
            onChange={setSku}
            className={s['search__input']}
          />

          <Button
            type="submit"
            buttonType="primary"
            buttonSize="s"
            leftIcon={<FontAwesomeIcon icon={faSearch} />}
            disabled={status === 'loading'}
          >
            Search
          </Button>
        </form>
        <div className={s['container']}>
          {products && products.filter((x: any) => !!x) && (
            <div
              className={classNames(s['products'], {
                [s['products__loading']]: status === 'loading',
              })}
            >
              {products.map((product: Product) => (
                <div
                  key={product.id}
                  onClick={() => ctx.resolve(product)}
                  className={s['product']}
                >
                  <div
                    className={s['product__image']}
                    style={{
                      backgroundImage: `url(${product.attributes.image_url})`,
                    }}
                  />
                  <div className={s['product__content']}>
                    <div className={s['product__title']}>
                      {product.attributes.name}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {status === 'loading' && <Spinner size={25} placement="centered" />}
          {status === 'success' && products && products.length === 0 && (
            <div className={s['empty']}>No products found!</div>
          )}
          {status === 'error' && (
            <div className={s['empty']}>API call failed!</div>
          )}
        </div>
      </div>
    </Canvas>
  );
}
