import { configure, ZipWriter } from '@zip.js/zip.js';
import type { ExportWorkspace } from '../utils/exportWorkspace';

configure({ useWebWorkers: false });

/** An `ExportWorkspace` in memory, recording what it would download. */
export class MemoryWorkspace {
  readonly files = new Map<string, Blob>();
  readonly downloads: { name: string; downloadName: string; blob: Blob }[] = [];
  clears = 0;

  async writable(name: string): Promise<WritableStream<Uint8Array>> {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    return new WritableStream<Uint8Array>({
      write: (chunk) => {
        chunks.push(new Uint8Array(chunk));
      },
      close: () => {
        this.files.set(name, new Blob(chunks));
      },
    });
  }

  async writeBlob(name: string, blob: Blob): Promise<void> {
    this.files.set(name, blob);
  }

  async zip(name: string): Promise<ZipWriter<unknown>> {
    return new ZipWriter(await this.writable(name));
  }

  async file(name: string): Promise<File> {
    const blob = this.files.get(name);
    if (!blob) throw new Error(`The workspace has no file ${name}.`);
    return new File([blob], name);
  }

  async remove(name: string): Promise<void> {
    this.files.delete(name);
  }

  async download(name: string, downloadName = name): Promise<void> {
    this.downloads.push({ name, downloadName, blob: await this.file(name) });
  }

  async clear(): Promise<void> {
    this.files.clear();
    this.clears++;
  }

  asWorkspace(): ExportWorkspace {
    return this as unknown as ExportWorkspace;
  }
}
