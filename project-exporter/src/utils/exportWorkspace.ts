import { configure, ZipWriter } from '@zip.js/zip.js';
import { downloadBlob } from './exportRuntime';

// Native CompressionStream already compresses off the main thread, so zip.js
// needs no worker scripts of its own.
configure({ useWebWorkers: false });

const DIRECTORY = 'project-exporter';

export class StorageUnavailableError extends Error {
  constructor() {
    super(
      'This browser cannot write exports to disk. Use a recent version of Chrome, Edge, Firefox or Safari.',
    );
    this.name = 'StorageUnavailableError';
  }
}

/**
 * Where an export is assembled: a directory of the browser's origin private
 * file system, so files grow on disk instead of in memory, and the browser
 * downloads the finished file once.
 *
 * A download keeps reading its file after the export returns, so files stay
 * until the next export opens the workspace and clears them.
 */
export class ExportWorkspace {
  private readonly open = new Set<WritableStreamDefaultWriter<Uint8Array>>();

  private constructor(private readonly directory: FileSystemDirectoryHandle) {}

  static async open(): Promise<ExportWorkspace> {
    if (
      typeof navigator === 'undefined' ||
      !navigator.storage?.getDirectory ||
      typeof FileSystemFileHandle === 'undefined' ||
      !('createWritable' in FileSystemFileHandle.prototype)
    )
      throw new StorageUnavailableError();
    const root = await navigator.storage.getDirectory();
    const workspace = new ExportWorkspace(
      await root.getDirectoryHandle(DIRECTORY, { create: true }),
    );
    await workspace.clear();
    return workspace;
  }

  /**
   * A new, empty file, written through the returned stream. The workspace
   * keeps the file's own writer, so `clear` can abort it even while a zip
   * or a pipe holds the returned stream.
   */
  async writable(name: string): Promise<WritableStream<Uint8Array>> {
    const handle = await this.directory.getFileHandle(name, { create: true });
    const writer = (await handle.createWritable()).getWriter();
    this.open.add(writer);
    return new WritableStream<Uint8Array>({
      write: (chunk) => writer.write(chunk),
      close: async () => {
        this.open.delete(writer);
        await writer.close();
      },
      abort: async (reason) => {
        this.open.delete(writer);
        await writer.abort(reason);
      },
    });
  }

  async writeBlob(name: string, blob: Blob): Promise<void> {
    await blob.stream().pipeTo(await this.writable(name));
  }

  /** A zip written straight to the workspace file `name`. */
  async zip(name: string): Promise<ZipWriter<unknown>> {
    return new ZipWriter(await this.writable(name));
  }

  async file(name: string): Promise<File> {
    return (await this.directory.getFileHandle(name)).getFile();
  }

  async remove(name: string): Promise<void> {
    await this.directory.removeEntry(name).catch(() => undefined);
  }

  async download(name: string, downloadName = name): Promise<void> {
    downloadBlob(await this.file(name), downloadName);
  }

  /** Discards every file, including ones still being written. */
  async clear(): Promise<void> {
    await Promise.all(
      Array.from(this.open, (writer) => writer.abort().catch(() => undefined)),
    );
    this.open.clear();
    const names: string[] = [];
    for await (const name of this.directory.keys()) names.push(name);
    await Promise.all(
      names.map((name) =>
        this.directory
          .removeEntry(name, { recursive: true })
          .catch(() => undefined),
      ),
    );
  }
}
