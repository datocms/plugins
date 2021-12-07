import Store, { thunk } from "repatch";
import produce from "immer";
import { Product, State, StoreTypes } from "../types";
import { Dispatch } from "redux";

export type FetchProductsTypes = {
  query: string;
  client: any;
};

const initialState = {
  query: null,
  products: {},
  searches: {},
};

const store = new Store(initialState).addMiddleware(thunk);
const act = (producer: (state: State) => void) => (state: State) =>
  produce(state, producer);

/* eslint-disable no-param-reassign */

export const fetchProductByCode =
  ({ code, client }: StoreTypes) =>
  () =>
  async (dispatch: Dispatch<any>) => {
    if (!client) {
      return;
    }

    dispatch(
      act((state: State) => {
        state.products[code] = state.products[code] || { result: null };
        state.products[code].status = "loading";
      })
    );

    const product = await client.productByCode(code);

    return dispatch(
      act((state: State) => {
        state.products[code].result = product;
        state.products[code].status = "success";
      })
    );
  };

export const fetchProductsMatching =
  ({ query, client }: FetchProductsTypes) =>
  () =>
  async (dispatch: Dispatch<any>) => {
    if (!client) {
      return;
    }

    dispatch(
      act((state: State) => {
        state.searches[query] = state.searches[query] || { result: [] };
        state.searches[query].status = "loading";
        state.query = query;
      })
    );

    const products: Product[] = await client.productsMatching(query);

    return dispatch(
      act((state: State) => {
        state.searches[query].status = "success";
        state.searches[query].result = products.map(
          (p: Product) => p.attributes.code
        );

        products.forEach((product) => {
          state.products[product.attributes.code] =
            state.products[product.attributes.code] || {};
          state.products[product.attributes.code].result = product;
        });
      })
    );
  };

export default store;
