import type { Modal } from 'datocms-plugin-sdk';
import type { LocalFileMention } from './mentions';

export const FILE_DETAILS_MODAL_ID = 'dato-agent-local-file-details';

type ModalOpener = {
  openModal: (modal: Modal) => Promise<unknown>;
};

export function openFileDetailsModal(
  ctx: ModalOpener,
  file: LocalFileMention,
  bytesAvailable: boolean,
): Promise<unknown> {
  return ctx.openModal({
    id: FILE_DETAILS_MODAL_ID,
    title: 'File details',
    width: 'm',
    initialHeight: 400,
    parameters: {
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      lastModified: file.lastModified,
      bytesAvailable,
    },
  });
}
