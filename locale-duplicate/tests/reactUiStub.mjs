import { registerHooks } from 'node:module';

// Node can't load most datocms-react-ui 3 entries (some of their dependencies
// import directories, which only a bundler resolves). Import this file before
// the components under test: every 'datocms-react-ui/<Entry>' becomes a small
// stand-in that records its props in globalThis.__reactUi[<name>] and renders
// a <div data-ui="<name>"> with its texts and children.

const reactUrl = new URL('../node_modules/react/index.js', import.meta.url)
  .href;

globalThis.__reactUi ??= {};

const stubSource = `
  import { createElement, isValidElement } from ${JSON.stringify(reactUrl)};

  const TEXT_PROPS = ['label', 'title', 'message', 'description', 'hint', 'placeholder'];

  function renderable(value) {
    return (
      typeof value === 'string' ||
      typeof value === 'number' ||
      isValidElement(value)
    );
  }

  export function makeStub(name) {
    const parts = new Map();
    function Stub(props = {}) {
      (globalThis.__reactUi[name] ??= []).push(props);
      const texts = TEXT_PROPS.map((key) => props[key]).filter(renderable);
      const children = typeof props.children === 'function' ? null : props.children;
      return createElement('div', { 'data-ui': name }, ...texts, children);
    }
    Stub.displayName = name;
    // Subcomponents (Page.Group, Pane.Header.Title, Table.Row…) are stubs too.
    // Only capitalized keys, so React's own checks on the type stay untouched.
    return new Proxy(Stub, {
      get(target, key, receiver) {
        if (typeof key !== 'string' || !/^[A-Z]/.test(key))
          return Reflect.get(target, key, receiver);
        if (!parts.has(key)) parts.set(key, makeStub(name + '.' + key));
        return parts.get(key);
      },
    });
  }
`;

const stubUrl = `data:text/javascript,${encodeURIComponent(stubSource)}`;

// The named exports of each entry, besides its default and the export named
// after the entry ({ Page }, { Table }, { Dropdown }…). Extend it as needed.
const namedExports = {
  Canvas: `
    export function useCtx() {
      return { ui: { locale: 'en' } };
    }
  `,
  Table: `
    export function useInMemoryTableLayout(layout) {
      return [layout, () => {}];
    }
  `,
  Toolbar: `
    export function useFilterToolbar() {
      return { open: false, onOpen() {}, onClose() {}, onToggle() {}, autoFocus: false };
    }
  `,
};

function entrySource(entry) {
  const name = entry.split('/').at(-1);
  const identifier = /^[A-Za-z_$][\w$]*$/.test(name) ? name : 'Stub';
  return `
    import { makeStub } from ${JSON.stringify(stubUrl)};
    const ${identifier} = makeStub(${JSON.stringify(name)});
    export default ${identifier};
    ${identifier === 'Stub' ? '' : `export { ${identifier} };`}
    ${namedExports[entry] ?? ''}
  `;
}

const dataUrl = (source) =>
  `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'datocms-react-ui/styles.css')
      return { url: dataUrl('export {};'), shortCircuit: true };
    if (specifier.startsWith('datocms-react-ui/'))
      return {
        url: dataUrl(entrySource(specifier.slice('datocms-react-ui/'.length))),
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});

/** The props of every render of a stub, in order: uiProps('Button') */
export function uiProps(name) {
  return globalThis.__reactUi[name] ?? [];
}

/** Clears the recorded props of every stub */
export function resetReactUi() {
  for (const name of Object.keys(globalThis.__reactUi)) {
    delete globalThis.__reactUi[name];
  }
}
