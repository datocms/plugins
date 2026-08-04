import type {
  LocalFileAttachmentDescriptor,
  LocalFileMention,
} from './mentions';

const filesById = new Map<string, File>();
let fallbackId = 0;

export const MAX_LOCAL_FILES_PER_MESSAGE = 5;
export const MAX_LOCAL_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_LOCAL_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_LOCAL_FILES_TOTAL_BYTES = 25 * 1024 * 1024;

export function localFileMaximumBytes(mimeType: string): number {
  return mimeType.startsWith('image/')
    ? MAX_LOCAL_IMAGE_FILE_BYTES
    : MAX_LOCAL_FILE_BYTES;
}

function createLocalFileId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `local-file-${globalThis.crypto.randomUUID()}`;
  }

  fallbackId += 1;
  return `local-file-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

export function localFileMentionFromDescriptor(
  descriptor: LocalFileAttachmentDescriptor,
): LocalFileMention {
  return { type: 'file', ...descriptor };
}

export function localFileDescriptorFromMention(
  mention: LocalFileMention,
): LocalFileAttachmentDescriptor {
  const { id, filename, mimeType, size, lastModified } = mention;
  return { id, filename, mimeType, size, lastModified };
}

export function registerLocalFile(file: File): LocalFileMention {
  let id = createLocalFileId();
  while (filesById.has(id)) id = createLocalFileId();

  filesById.set(id, file);
  return {
    type: 'file',
    id,
    filename: file.name || 'Untitled file',
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    lastModified: file.lastModified,
  };
}

export function getSessionLocalFile(id: string): File | undefined {
  return filesById.get(id);
}

export function hasSessionLocalFileBytes(id: string): boolean {
  return filesById.has(id);
}

/** Test-only cleanup; browser navigation naturally releases the registry. */
export function clearSessionLocalFiles(): void {
  filesById.clear();
}
