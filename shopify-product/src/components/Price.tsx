import { PriceTypes } from "../types";

export default function Price({ amount, currencyCode }: PriceTypes) {
  return (
    <span>
      {currencyCode}
      &nbsp;
      {amount}
    </span>
  );
}
