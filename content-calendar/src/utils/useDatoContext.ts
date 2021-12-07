import { RenderPageCtx } from 'datocms-plugin-sdk';
import { useContext, createContext } from 'react';

export const DatoContext = createContext<RenderPageCtx>(
  undefined as any as RenderPageCtx,
);

export function useDatoContext() {
  return useContext(DatoContext);
}
