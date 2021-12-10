import { useDispatch, useSelector } from "react-redux";
// @ts-ignore
import { EmptyProps, State, onSelectParameters, Product } from "../../types";
import { fetchProductsMatching } from "../store";
import { useCallback, useEffect, useState } from "react";
import { Button, TextField } from "datocms-react-ui";
import style from "./styles.module.css";

export default function Empty({ client, onSelect }: EmptyProps) {
  const dispatch = useDispatch();
  const [sku, setSku] = useState<string | undefined>(undefined);

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

  const handleSubmit = () => {
    if (sku) {
      performSearch(sku);
    }
  };

  const handleSelect = ({ product }: onSelectParameters) => {
    onSelect({ product });
  };

  const renderResult = ({ product }: onSelectParameters) => {
    return (
      <div
        key={product.id}
        onClick={() => handleSelect({ product })}
        className={style.empty__product}
      >
        <div
          className={style.empty__product__image}
          style={{ backgroundImage: `url(${product.attributes.image_url})` }}
        />
        <div className={style.empty__product__content}>
          <div className={style.empty__product__title}>
            {product.attributes.name}
          </div>
          <div className={style.empty__product__code}>
            {product.attributes.code}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={style.empty}>
      <div className={style.empty__label}>No SKU selected</div>
      <form className={style.empty__search} onSubmit={handleSubmit}>
        <div className={style.empty__search__input}>
          <TextField
            placeholder="Search for SKU or titles... (ie. baseball cap)"
            id="sku"
            name="sku"
            label=""
            value={sku}
            onChange={setSku}
          />
        </div>
        <Button
          disabled={status === "loading"}
          buttonType="negative"
          buttonSize="s"
        >
          Search
          <span className={style.spinner} />
        </Button>
      </form>
      {products && (
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
  );
}
