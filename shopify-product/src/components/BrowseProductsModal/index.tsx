import { useDispatch, useSelector } from "react-redux";
import { State, onSelectType, Product } from "../../types";
import Client from "../client";
import { RenderModalCtx } from "datocms-plugin-sdk";
import { fetchProductsMatching } from "../store";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button, TextInput, Canvas } from "datocms-react-ui";
import style from "./styles.module.css";

export default function BrowseProductsModal({ ctx }: { ctx: RenderModalCtx }) {
  const dispatch = useDispatch();
  const [sku, setSku] = useState<string>("");

  const storefrontAccessToken = ctx.plugin.attributes.parameters
    .storefrontAccessToken as string;
  const shopifyDomain = ctx.plugin.attributes.parameters
    .shopifyDomain as string;

  const client = useMemo(() => {
    return new Client({ shopifyDomain, storefrontAccessToken });
  }, [storefrontAccessToken, shopifyDomain]);

  const performSearch = useCallback(
    (query: string) => {
      dispatch(fetchProductsMatching({ query, client }));
    },
    [client, dispatch]
  );

  const { query, status, products } = useSelector((state: State) => {
    const search = state.searches[state.query] || {
      status: "loading",
      result: [],
    };

    return {
      query: state.query,
      status: search.status,
      products: search.result.map((id: string) => state.products[id].result),
    };
  });

  useEffect(() => {
    performSearch(query);
  }, [performSearch, query]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (sku) {
      performSearch(sku);
    }
  };

  const handleSelect: onSelectType = ({ product }) => {
    ctx.resolve({ product });
  };

  const renderResult = ({ product }: { product: Product }) => {
    return (
      <div
        key={product.handle}
        onClick={() => handleSelect({ product })}
        className={style.empty__product}
      >
        <div
          className={style.empty__product__image}
          style={{ backgroundImage: `url(${product.imageUrl})` }}
        />
        <div className={style.empty__product__content}>
          <div className={style.empty__product__title}>{product.title}</div>
        </div>
      </div>
    );
  };

  return (
    <Canvas ctx={ctx}>
      <div className={style.empty}>
        <form className={style.empty__search} onSubmit={handleSubmit}>
          <div className={style.empty__search__input}>
            <TextInput
              placeholder="Search products... (ie. mens shirts)"
              id="sku"
              name="sku"
              value={sku}
              onChange={setSku}
            />
          </div>
          <Button
            type="submit"
            buttonType="negative"
            buttonSize="s"
            className={
              status === "loading" ? style.button__loading : style.button
            }
          >
            Search
            <span className={style.spinner} />
          </Button>
        </form>
        {products.filter((x: any) => !!x) && (
          <div
            className={
              status === "loading"
                ? style.empty__products__loading
                : style.empty__products
            }
          >
            {products.map((product: Product) => renderResult({ product }))}
          </div>
        )}
      </div>
    </Canvas>
  );
}