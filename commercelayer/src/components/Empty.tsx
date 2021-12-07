import { useDispatch, useSelector } from "react-redux";
// @ts-ignore
import cn from "classname";
import { EmptyTypes, State, onSelectParameters } from "../types";
import { fetchProductsMatching } from "./store";
import { useCallback, useEffect } from "react";

export default function Empty({ client, onSelect }: EmptyTypes) {
  const dispatch = useDispatch();

  const performSearch = useCallback(
    (query: any) => {
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
    // performSearch(el.value);
  };

  const handleSelect = ({ product }: onSelectParameters) => {
    onSelect({ product });
  };

  const renderResult = ({ product }: onSelectParameters) => {
    return (
      <button
        className="empty__product"
        type="button"
        key={product.id}
        onClick={() => handleSelect({ product })}
      >
        <div
          className="empty__product__image"
          style={{ backgroundImage: `url(${product.attributes.image_url})` }}
        />
        <div className="empty__product__content">
          <div className="empty__product__title">{product.attributes.name}</div>
          <div className="empty__product__code">{product.attributes.code}</div>
        </div>
      </button>
    );
  };

  return (
    <div className="empty">
      <div className="empty__label">No SKU selected</div>
      <form className="empty__search" onSubmit={handleSubmit}>
        <div className="empty__search__input">
          <input
            placeholder="Search for SKU or titles... (ie. baseball cap)"
            type="text"
          />
        </div>
        <button
          className={cn("DatoCMS-button--primary", {
            loading: status === "loading",
          })}
          type="submit"
        >
          Search
          <span className="spinner" />
        </button>
      </form>
      {products && (
        <div
          className={cn("empty__products", { loading: status === "loading" })}
        >
          {products.map(renderResult)}
        </div>
      )}
    </div>
  );
}
