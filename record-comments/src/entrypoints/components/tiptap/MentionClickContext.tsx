import { createContext, useContext } from 'react';
import type { Mention } from '@ctypes/mentions';

type MentionClickHandler = (mention: Mention, event: React.MouseEvent) => void;

type MentionClickContextType = {
  onMentionClick?: MentionClickHandler;
};

export const MentionClickContext = createContext<MentionClickContextType>({});

export function useMentionClick() {
  return useContext(MentionClickContext);
}
