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

export const fetchProductByCode = (code, client) => () => (dispatch) => {
  dispatch(act((state) => {
    state.products[code] = state.products[code] || { result: null };
    state.products[code].status = 'loading';
  }));

  return client.productByCode(code)
    .then((product) => {
      dispatch(act((state) => {
        state.products[code].result = product;
        state.products[code].status = 'success';
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
        state.searches[query].result = products.map(p => p.attributes.code);
        products.forEach((product) => {
          state.products[product.attributes.code] = state.products[product.attributes.code] || {};
          state.products[product.attributes.code].result = product;
        });
      }));
    });
};

export default store;
