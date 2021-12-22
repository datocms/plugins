import create from 'zustand';
import { persist } from 'zustand/middleware';
import produce from 'immer';
import ShopifyClient, { Product } from './ShopifyClient';

export type Status = 'loading' | 'success' | 'error';

export type State = {
  query: string;
  searches: Record<string, { result: string[] | null; status: Status }>;
  products: Record<string, { result: Product | null; status: Status }>;
  getProduct(handle: string): {
    status: Status;
    product: Product | null;
  };
  getCurrentSearch(): {
    query: string;
    status: Status;
    products: Product[] | null;
  };
  fetchProductByHandle(client: ShopifyClient, handle: string): Promise<void>;
  fetchProductsMatching(client: ShopifyClient, query: string): Promise<void>;
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
        getProduct(handle: string) {
          const selectedProduct = get().products[handle];

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
        async fetchProductByHandle(client, handle) {
          set((state) => {
            state.products[handle] = state.products[handle] || { result: null };
            state.products[handle].status = 'loading';
          });

          try {
            const product = await client.productByHandle(handle);

            set((state) => {
              state.products[handle].result = product;
              state.products[handle].status = 'success';
            });
          } catch (e) {
            set((state) => {
              state.products[handle].result = null;
              state.products[handle].status = 'error';
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
              state.searches[query].result = products.map((p) => p.handle);

              products.forEach((product) => {
                state.products[product.handle] =
                  state.products[product.handle] || {};
                state.products[product.handle].result = product;
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
      name: 'shopifyStore',
    },
  ),
);

export default useStore;
