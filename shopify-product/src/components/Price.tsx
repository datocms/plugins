import { PriceTypes } from "../utils/ShopifyClient";

export default function Price({ amount, currencyCode }: PriceTypes) {
  return (
    <span>
      {currencyCode}
      &nbsp;
      {amount}
    </span>
  );
}
