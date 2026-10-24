import type { Mention } from '@ctypes/mentions';
import { createContext, useContext } from 'react';

type MentionClickHandler = (mention: Mention, event: React.MouseEvent) => void;

type MentionClickContextType = {
  onMentionClick?: MentionClickHandler;
  /**
   * The editor can change the draft. The editor turns off without an event
   * that a node view can follow, thus the composer tells it here.
   */
  editable?: boolean;
};

export const MentionClickContext = createContext<MentionClickContextType>({});

export function useMentionClick() {
  return useContext(MentionClickContext);
}
