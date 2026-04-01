---
name: verify
description: Run lint and build checks for the current plugin to verify changes are correct.
---

Run lint and build checks for the plugin currently being worked on. Execute from the plugin's directory:

```bash
npm run lint && npm run build
```

If the plugin has tests (check for a `test` script in its `package.json`), also run:

```bash
npm run test
```

Report any errors clearly, grouped by category (lint errors, type errors, build errors, test failures).
