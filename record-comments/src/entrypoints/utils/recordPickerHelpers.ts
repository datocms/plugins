import type { RecordMention } from '@ctypes/mentions';
import type { ItemType } from 'datocms-plugin-sdk';
import { extractLeadingEmoji } from './emojiUtils';

export type RecordPickerModelInfo = {
  id: string;
  apiKey: string;
  name: string;
  isBlockModel: boolean;
};

/**
 * The mention of a record that the user picked. The pill shows the record as
 * the host presents it: a RecordRow loads its title, its image and its status
 * from the ID, thus the mention only names the record and its model (the
 * title is a fallback text).
 */
export function createRecordMention(
  recordId: string,
  model: RecordPickerModelInfo,
  itemType: ItemType | undefined,
): RecordMention {
  return {
    type: 'record',
    id: recordId,
    title: `Record #${recordId}`,
    modelId: model.id,
    modelApiKey: model.apiKey,
    modelName: model.name,
    modelEmoji: extractLeadingEmoji(model.name).emoji,
    thumbnailUrl: null,
    isSingleton: itemType?.attributes.singleton ?? false,
  };
}
