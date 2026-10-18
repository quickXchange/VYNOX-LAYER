import { Readable } from "node:stream";
import { installDisposableTestObjectStore } from "../lib/private-object-storage";
/** Only tests use memory; Development browser evidence uses real private storage. */
export function installCIStorage() {
  const files = new Map<string, Buffer>();
  installDisposableTestObjectStore(key => ({
    async save(bytes, options) {
      if (options?.preconditionOpts?.ifGenerationMatch === 0 && files.has(key)) throw new Error("Immutable object already exists");
      files.set(key, Buffer.from(bytes));
    },
    async download() { const b = files.get(key); if (!b) throw new Error("Missing fixture object"); return [Buffer.from(b)]; },
    async delete() { files.delete(key); },
    async exists() { return [files.has(key)]; },
    createReadStream() { const b = files.get(key); return Readable.from(b ? [b] : []); },
  }));
}
