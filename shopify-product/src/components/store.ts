import Store, { thunk } from "repatch";
import produce from "immer";
import { State, StoreTypes } from "../types";
import { Dispatch } from "redux";
import Client from "./client";

export type FetchProductsTypes = {
  query: string;
  client: Client;
};

const initialState = {
  query: null,
  products: {},
  searches: {},
};

const store = new Store(initialState).addMiddleware(thunk);
const act = (producer: (state: State) => void) => (state: State) =>
  produce(state, producer);

export const fetchProductByHandle =
  ({ handle, client }: StoreTypes) =>
  () =>
  (dispatch: Dispatch<any>) => {
    dispatch(
      act((state) => {
        state.products[handle] = state.products[handle] || { result: null };
        state.products[handle].status = "loading";
      })
    );

    return (
      client &&
      client.productByHandle(handle).then((product) => {
        dispatch(
          act((state) => {
            state.products[handle].result = product;
            state.products[handle].status = "success";
          })
        );
      })
    );
  };

export const fetchProductsMatching =
  ({ query, client }: FetchProductsTypes) =>
  () =>
  (dispatch: Dispatch<any>) => {
    dispatch(
      act((state) => {
        state.searches[query] = state.searches[query] || { result: [] };
        state.searches[query].status = "loading";
        state.query = query;
      })
    );

    return client.productsMatching(query).then((products) => {
      dispatch(
        act((state) => {
          state.searches[query].status = "success";
          state.searches[query].result = products.map((p) => p.handle);
          products.forEach((product) => {
            state.products[product.handle] =
              state.products[product.handle] || {};
            state.products[product.handle].result = product;
          });
        })
      );
    });
  };

export default store;
