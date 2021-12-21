import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { State } from "../../types";
import { fetchProductByHandle } from "../store";
import { ValueProps } from "../../types";
import style from "./styles.module.css";
import Price from "../Price";

export default function Value({ value, client, onReset, ctx }: ValueProps) {
  const dispatch = useDispatch();

  const { product, status } = useSelector((state: State) => {
    const selectedProduct = state.products[value];

    return {
      status:
        selectedProduct && selectedProduct.status
          ? selectedProduct.status
          : "loading",
      product: selectedProduct && selectedProduct.result,
    };
  });

  const findProduct = useCallback(
    (handle: string) => {
      dispatch(fetchProductByHandle({ handle, client }));
    },
    [client, dispatch]
  );

  useEffect(() => {
    findProduct(value);
  }, [value, findProduct]);

  return (
    <div className={status === "loading" ? style.value__loading : style.value}>
      {product && (
        <div className={style.value__product}>
          <div
            className={style.value__product__image}
            style={{ backgroundImage: `url(${product.imageUrl})` }}
          />
          <div className={style.value__product__info}>
            <div className={style.value__product__title}>
              <a
                href={product.onlineStoreUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {product.title}
              </a>
            </div>
            <div className={style.value__product__description}>
              {product.description}
            </div>
            {product.productType && (
              <div className={style.value__product__producttype}>
                <strong>Product type:</strong>
                &nbsp;
                {product.productType}
              </div>
            )}

            <div className={style.value__product__price}>
              <strong>Price:</strong>
              &nbsp;
              {product.priceRange.maxVariantPrice.amount !==
              product.priceRange.minVariantPrice.amount ? (
                <span>
                  <Price {...product.priceRange.minVariantPrice} />
                  &nbsp; - &nbsp;
                  <Price {...product.priceRange.maxVariantPrice} />
                </span>
              ) : (
                <Price {...product.priceRange.maxVariantPrice} />
              )}
            </div>
          </div>
        </div>
      )}
      <button type="button" onClick={onReset} className={style.value__reset} />
    </div>
  );
}
