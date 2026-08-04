import { fileURLToPath, URL } from 'node:url';

export const recordCommentsAliases = [
  {
    find: '@ctypes',
    replacement: fileURLToPath(
      new URL('./src/recordComments/entrypoints/types', import.meta.url),
    ),
  },
  {
    find: '@hooks',
    replacement: fileURLToPath(
      new URL('./src/recordComments/entrypoints/hooks', import.meta.url),
    ),
  },
  {
    find: '@styles',
    replacement: fileURLToPath(
      new URL('./src/recordComments/entrypoints/styles', import.meta.url),
    ),
  },
  {
    find: '@utils',
    replacement: fileURLToPath(
      new URL('./src/recordComments/entrypoints/utils', import.meta.url),
    ),
  },
  {
    find: /^@\//,
    replacement: `${fileURLToPath(
      new URL('./src/recordComments', import.meta.url),
    )}/`,
  },
] as const;
