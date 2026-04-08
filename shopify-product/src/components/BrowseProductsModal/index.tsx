import { faSearch } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import classNames from 'classnames';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner, TextInput } from 'datocms-react-ui';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { parseAndNormalizeConfig } from '../../types';
import ShopifyClient, { type Product } from '../../utils/ShopifyClient';
import useStore, { type State } from '../../utils/useStore';
import s from './styles.module.css';

export default function BrowseProductsModal({ ctx }: { ctx: RenderModalCtx }) {
  const performSearch = useStore(
    (state) => (state as State).fetchProductsMatching,
  );

  // Select primitives directly — these are referentially stable and safe
  // to use as zustand selectors without useShallow.
  const query = useStore((state) => (state as State).query);
  const status = useStore(
    (state) =>
      (state as State).searches[(state as State).query]?.status ?? 'loading',
  );

  // Derives the product list by joining search result handles against the
  // products cache. Returns a new array each time, so useShallow is required
  // to compare elements by reference and avoid infinite re-renders.
  const products = useStore(
    useShallow((state) => {
      const s = state as State;
      const result = s.searches[s.query]?.result;
      if (!result) return null;
      return result
        .map((handle: string) => s.products[handle]?.result)
        .filter((p): p is Product => !!p);
    }),
  );

  const [sku, setSku] = useState<string>('');

  const { storefrontAccessToken, shopifyDomain } = parseAndNormalizeConfig(
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
          {!!products?.length && (
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
