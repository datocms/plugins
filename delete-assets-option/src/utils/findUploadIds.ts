function ownUploadId(item: Record<string, unknown>): unknown {
  // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn needs ES2022; this plugin targets ES2020.
  return Object.prototype.hasOwnProperty.call(item, 'upload_id')
    ? item.upload_id
    : undefined;
}

const findUploadIds = (obj: Record<string, unknown>): string[] | null => {
  const uploadIds = new Set<string>();
  const visited = new WeakSet<object>();
  const pending: unknown[] = [obj];

  while (pending.length > 0) {
    const value = pending.pop();

    if (typeof value !== 'object' || value === null || visited.has(value)) {
      continue;
    }

    visited.add(value);

    const item = value as Record<string, unknown>;
    const uploadId = ownUploadId(item);

    if (typeof uploadId === 'string' && uploadId.trim().length > 0) {
      uploadIds.add(uploadId);
    }

    // Reverse insertion retains the original depth-first discovery order.
    const keys = Object.keys(item);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      pending.push(item[keys[index]]);
    }
  }

  return uploadIds.size > 0 ? Array.from(uploadIds) : null;
};

export default findUploadIds;
