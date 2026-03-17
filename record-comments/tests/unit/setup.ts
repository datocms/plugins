declare global {
  // React checks this flag before suppressing act() environment warnings.
  // Keeping it on for the test suite matches how the custom render helpers use act().
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export {};
