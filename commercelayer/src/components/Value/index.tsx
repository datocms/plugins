import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { State } from "../../types";
import { fetchProductByCode } from "../store";
import { ValueProps } from "../../types";
import style from "./styles.module.css";

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
    (code: string) => {
      dispatch(fetchProductByCode({ code, client }));
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
            style={{
              backgroundImage: `url(${product.attributes.image_url})`,
            }}
          />
          <div className={style.value__product__info}>
            <div className={style.value__product__title}>
              <a
                href={`${ctx.parameters.baseEndpoint}/admin/skus/${product.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {product.attributes.name}
              </a>
            </div>
            <div className={style.value__product__code}>
              SKU &nbsp;
              {product.attributes.code}
            </div>
            <div className={style.value__product__description}>
              {product.attributes.description}
            </div>
          </div>
        </div>
      )}
      <button type="button" onClick={onReset} className={style.value__reset} />
    </div>
  );
}
