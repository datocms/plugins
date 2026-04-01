import { faSearch } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import classNames from 'classnames';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner, TextInput } from 'datocms-react-ui';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { normalizeConfig } from '../../types';
import ShopifyClient, { type Product } from '../../utils/ShopifyClient';
import useStore, { type State } from '../../utils/useStore';
import s from './styles.module.css';

export default function BrowseProductsModal({ ctx }: { ctx: RenderModalCtx }) {
  const performSearch = useStore(
    (state) => (state as State).fetchProductsMatching,
  );
  const { query, status, products } = useStore((state) =>
    (state as State).getCurrentSearch(),
  );

  const [sku, setSku] = useState<string>('');

  const { storefrontAccessToken, shopifyDomain } = normalizeConfig(
    ctx.plugin.attributes.parameters,
  );

  const client = useMemo(() => {
    return new ShopifyClient({ shopifyDomain, storefrontAccessToken });
  }, [storefrontAccessToken, shopifyDomain]);

  useEffect(() => {
    performSearch(client, query);
  }, [performSearch, query, client]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    performSearch(client, sku);
  };

  return (
    <Canvas ctx={ctx}>
      <div className={s.browse}>
        <form className={s.search} onSubmit={handleSubmit}>
          <TextInput
            placeholder="Search products... (ie. mens shirts)"
            id="sku"
            name="sku"
            value={sku}
            onChange={setSku}
            className={s.search__input}
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
        <div className={s.container}>
          {products?.filter((x) => !!x) && (
            <div
              className={classNames(s.products, {
                [s.products__loading]: status === 'loading',
              })}
            >
              {products.map((product: Product) => (
                <button
                  key={product.handle}
                  onClick={() => ctx.resolve(product)}
                  className={s.product}
                >
                  <div
                    className={s.product__image}
                    style={{ backgroundImage: `url(${product.imageUrl})` }}
                  />
                  <div className={s.product__content}>
                    <div className={s.product__title}>{product.title}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {status === 'loading' && <Spinner size={25} placement="centered" />}
          {status === 'success' && products && products.length === 0 && (
            <div className={s.empty}>No products found!</div>
          )}
          {status === 'error' && (
            <div className={s.empty}>API call failed!</div>
          )}
        </div>
      </div>
    </Canvas>
  );
}
