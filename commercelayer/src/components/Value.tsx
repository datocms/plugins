import { RenderFieldExtensionCtx } from "datocms-plugin-sdk";
// @ts-ignore
import cn from "classname";
import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { State } from "../types";

import Client from "./client";
import { fetchProductByCode } from "./store";

type Props = {
  value: string;
  client: Client | null;
  onReset: () => void;
  ctx: RenderFieldExtensionCtx;
};

export default function Value({ value, client, onReset, ctx }: Props) {
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
    <div className={cn("value", { loading: status === "loading" })}>
      {product && (
        <div className="value__product">
          <div
            className="value__product__image"
            style={{
              backgroundImage: `url(${product.attributes.image_url})`,
            }}
          />
          <div className="value__product__info">
            <div className="value__product__title">
              <a
                href={`${ctx.parameters.baseEndpoint}/admin/skus/${product.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {product.attributes.name}
              </a>
            </div>
            <div className="value__product__code">
              SKU &nbsp;
              {product.attributes.code}
            </div>
            <div className="value__product__description">
              {product.attributes.description}
            </div>
          </div>
        </div>
      )}
      <button type="button" className="value__reset" onClick={onReset} />
    </div>
  );
}
