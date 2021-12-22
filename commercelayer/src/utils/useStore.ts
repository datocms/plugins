import create from 'zustand';
import { persist } from 'zustand/middleware';
import produce from 'immer';
import CommerceLayerClient, { Product } from './CommerceLayerClient';

export type Status = 'loading' | 'success' | 'error';

export type State = {
  query: string;
  searches: Record<string, { result: string[] | null; status: Status }>;
  products: Record<string, { result: Product | null; status: Status }>;
  getProduct(code: string): {
    status: Status;
    product: Product | null;
  };
  getCurrentSearch(): {
    query: string;
    status: Status;
    products: Product[] | null;
  };
  fetchProductByCode(client: CommerceLayerClient, code: string): Promise<void>;
  fetchProductsMatching(
    client: CommerceLayerClient,
    query: string,
  ): Promise<void>;
};

const useStore = create<State>(
  persist(
    (rawSet, get) => {
      const set = (setFn: (s: State) => void) => {
        return rawSet(produce(setFn));
      };

      return {
        query: '',
        products: {},
        searches: {},
        getProduct(code: string) {
          const selectedProduct = get().products[code];

          return {
            status:
              selectedProduct && selectedProduct.status
                ? selectedProduct.status
                : 'loading',
            product: selectedProduct && selectedProduct.result,
          };
        },
        getCurrentSearch() {
          const state = get();

          const search = state.searches[state.query] || {
            status: 'loading',
            result: [],
          };

          return {
            query: state.query,
            status: search.status,
            products:
              search.result &&
              search.result.map((id: string) => state.products[id].result!),
          };
        },
        async fetchProductByCode(client, code) {
          set((state) => {
            state.products[code] = state.products[code] || { result: null };
            state.products[code].status = 'loading';
          });

          try {
            const product = await client.productByCode(code);

            set((state) => {
              state.products[code].result = product;
              state.products[code].status = 'success';
            });
          } catch (e) {
            set((state) => {
              state.products[code].result = null;
              state.products[code].status = 'error';
            });
          }
        },
        async fetchProductsMatching(client, query) {
          set((state) => {
            state.searches[query] = state.searches[query] || { result: [] };
            state.searches[query].status = 'loading';
            state.query = query;
          });

          try {
            const products = await client.productsMatching(query);

            set((state) => {
              state.searches[query].status = 'success';
              state.searches[query].result = products.map(
                (p) => p.attributes.code,
              );

              products.forEach((product) => {
                state.products[product.attributes.code] =
                  state.products[product.attributes.code] || {};
                state.products[product.attributes.code].result = product;
              });
            });
          } catch (e) {
            set((state) => {
              state.searches[query].status = 'error';
              state.searches[query].result = null;
            });
          }
        },
      };
    },
    {
      name: 'commerceLayerStore',
    },
  ),
);

export default useStore;
