/// <reference types="vite/client" />

import "react-table";

declare module "react-table" {
  export interface ColumnInstance<
    D extends Record<string, unknown> = Record<string, unknown>
  > extends UseResizeColumnsColumnProps<D> {}
}