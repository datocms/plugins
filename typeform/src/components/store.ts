import Store, { thunk } from "repatch";
import produce from "immer";
import {
  Form,
  State,
  TypeformIdentityTypes,
  TypeformQueryTypes,
} from "../types";
import { Dispatch } from "redux";

const initialState = {
  query: null,
  forms: {},
  themes: {},
  searches: {},
  results: {},
};

const store = new Store(initialState).addMiddleware(thunk);
const act = (producer: (state: State) => void) => (state: State) =>
  produce(state, producer);

const hrefToId = (href: string) => {
  const match = href.match(/[^/]+$/);
  return match && match[0];
};

export const fetchThemeById =
  ({ id, client }: TypeformIdentityTypes) =>
  () =>
  (dispatch: Dispatch<any>) => {
    if (!client) {
      return;
    }

    return client.themeById(id).then((theme) => {
      dispatch(
        act((state: State) => {
          state.themes[`https://api.typeform.com/themes/${theme.id}`] = theme;
        })
      );
    });
  };

export const fetchResultsById =
  ({ id, client }: TypeformIdentityTypes) =>
  () =>
  (dispatch: Dispatch<any>) => {
    if (!client) {
      return;
    }

    return client.formResultsById(id).then((results) => {
      dispatch(
        act((state: State) => {
          state.results[id] = results;
        })
      );
    });
  };

export const fetchFormById =
  ({ id, client }: TypeformIdentityTypes) =>
  () =>
  (dispatch: Dispatch<any>) => {
    if (!client) {
      return;
    }

    dispatch(
      act((state: State) => {
        state.forms[id] = state.forms[id] || { result: null };
        state.forms[id].status = "loading";
      })
    );

    dispatch(fetchResultsById(hrefToId(id), client));

    return client.formById(id).then((form) => {
      dispatch(fetchThemeById(hrefToId(form.theme.href), client));
      dispatch(
        act((state: State) => {
          state.forms[id].result = form;
          state.forms[id].status = "success";
        })
      );
    });
  };

export const fetchFormsMatching =
  ({ query, client }: TypeformQueryTypes) =>
  () =>
  (dispatch: Dispatch<any>) => {
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

    return client.formsMatching(query).then((forms) => {
      dispatch(
        act((state: State) => {
          state.searches[query].status = "success";
          state.searches[query].result = forms.map((f) => f.id);
          forms.forEach((form: Form) => {
            state.forms[form.id] = state.forms[form.id] || {};
            state.forms[form.id].result = form;
            dispatch(fetchThemeById(hrefToId(form.theme.href), client));
          });
        })
      );
    });
  };

export default store;

/* eslint-disable no-param-reassign */

// export const fetchProductByCode =
//   ({ code, client }: StoreTypes) =>
//   () =>
//   async (dispatch: Dispatch<any>) =>
//     if (!client) {
//       return;
//     }

//     dispatch(
//       act((state: State) => {
//         state.products[code] = state.products[code] || { result: null };
//         state.products[code].status = "loading";
//       })
//     );

//     const product = await client.productByCode(code);

//     return dispatch(
//       act((state: State) => {
//         state.products[code].result = product;
//         state.products[code].status = "success";
//       })
//     );
//   };

// export const fetchProductsMatching =
//   ({ query, client }: FetchProductsTypes) =>
//   () =>
//   async (dispatch: Dispatch<any>) =>

//     if (!client) {
//       return;
//     }

//     dispatch(
//       act((state: State) => {
//         state.searches[query] = state.searches[query] || { result: [] };
//         state.searches[query].status = "loading";
//         state.query = query;
//       })
//     );

//     const products: Product[] = await client.productsMatching(query);

//     return dispatch(
//       act((state: State) => {
//         state.searches[query].status = "success";
//         state.searches[query].result = products.map(
//           (p: Product) => p.attributes.code
//         );

//         products.forEach((product) => {
//           state.products[product.attributes.code] =
//             state.products[product.attributes.code] || {};
//           state.products[product.attributes.code].result = product;
//         });
//       })
//     );
//   };

// export default store;
