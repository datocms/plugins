export async function promiseAllWithProgress(
  promises: Promise<unknown>[],
  cb: (completed: number, total: number) => void,
) {
  let completed = 0;
  cb(completed, promises.length);
  await Promise.all(
    promises.map(async (promise) => {
      await promise;
      completed += 1;
      cb(completed, promises.length);
    }),
  );
}
