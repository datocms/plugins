// node-domexception is deprecated in favour of the platform's native
// DOMException, which every supported Node.js version provides globally.
// fetch-blob (pulled in by the Node-only auth stack of @google/genai) still
// imports it, so the package.json override points that import here.
export default globalThis.DOMException;
