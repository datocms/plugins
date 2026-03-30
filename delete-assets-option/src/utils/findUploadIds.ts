const findUploadIds = (obj: any): string[] | null => {
  const uploadIds: Set<string> = new Set();

  const traverse = (item: Record<string, unknown>) => {
    if (typeof item !== 'object' || item === null) return;

    if ('upload_id' in item && typeof item.upload_id === 'string') {
      uploadIds.add(item.upload_id);
    }

    for (const key in item) {
      traverse(item[key] as Record<string, unknown>);
    }
  };

  traverse(obj);

  return uploadIds.size > 0 ? Array.from(uploadIds) : null;
};

export default findUploadIds;
