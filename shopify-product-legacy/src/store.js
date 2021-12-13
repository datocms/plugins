import Store, { thunk } from 'repatch';
import produce from 'immer';

const initialState = {
  query: null,
  products: {},
  searches: {},
};

const store = new Store(initialState).addMiddleware(thunk);
const act = producer => state => produce(state, producer);

/* eslint-disable no-param-reassign */

export const fetchProductByHandle = (handle, client) => () => (dispatch) => {
  dispatch(act((state) => {
    state.products[handle] = state.products[handle] || { result: null };
    state.products[handle].status = 'loading';
  }));

  return client.productByHandle(handle)
    .then((product) => {
      dispatch(act((state) => {
        state.products[handle].result = product;
        state.products[handle].status = 'success';
      }));
    });
};

export const fetchProductsMatching = (query, client) => () => (dispatch) => {
  dispatch(act((state) => {
    state.searches[query] = state.searches[query] || { result: [] };
    state.searches[query].status = 'loading';
    state.query = query;
  }));

  return client.productsMatching(query)
    .then((products) => {
      dispatch(act((state) => {
        state.searches[query].status = 'success';
        state.searches[query].result = products.map(p => p.handle);
        products.forEach((product) => {
          state.products[product.handle] = state.products[product.handle] || {};
          state.products[product.handle].result = product;
        });
      }));
    });
};

export default store;
