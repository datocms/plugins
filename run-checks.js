const { execSync } = require("child_process");

const TESTABLE_PLUGINS = [
  "star-rating-editor",
  "yandex-translate",
  "todo-list",
  "tag-editor",
  "lorem-ipsum",
  "notes",
  "conditional-fields",
  "shopify-product",
  "commercelayer",
];

const runTests = (path) => {
  const root = process.cwd();
  process.chdir(path);
  execSync("npm run", { stdio: [0, 1, 2] });
  let testExitCode = 0;
  try {
    execSync("npm run lint && npm run dist", { stdio: [0, 1, 2] });
  } catch (error) {
    testExitCode = 1;
  } finally {
    process.chdir(root);
  }
  return testExitCode;
};

let finalExitCode = 0;

TESTABLE_PLUGINS.forEach((path) => {
  console.log(`\nRunning tests for '${path}'`);
  const testExitCode = runTests(path);
  if (testExitCode !== 0) {
    finalExitCode = 1;
  }
});

process.exit(finalExitCode);
