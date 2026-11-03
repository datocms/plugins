# Changelog

## 3.2.0

- Deleting a record shows a notice while Record Bin saves its copy, so the few-second wait no longer looks stuck.
- Environments without the "Improved items listing" update archive the current version of a record. Before, deleting a never-published draft was blocked, and a record with unpublished changes was archived as its old published version.
- Blocked deletions and failed restores show error toasts and no longer wait for them to close. The CMS no longer reports Record Bin as slow, and "Restore record" is ready to retry right away.

## 3.1.0

- Records too large for a single archive field are stored compressed instead of being lost, and deletion is blocked when the archive copy can't be saved.
- Requests to DatoCMS use the client's built-in retry again.

## 3.0.11

- Move the changelog out of the README and into this file.

## 3.0.10

- README and video update.

## 3.0.9 and prior

- No changelog kept.
