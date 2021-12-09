import { createContext, useContext } from 'react';

type HoverItemContextType = {
  modelId: string | null;
  setModelId: (id: string | null) => void;
};

export const HoverItemContext = createContext<HoverItemContextType>({
  modelId: null,
  setModelId: () => {},
});

export function useHoverModelId() {
  return useContext(HoverItemContext).modelId;
}
