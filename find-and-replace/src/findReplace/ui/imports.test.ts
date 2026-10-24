import { describe, expect, it } from 'vitest';

/** Every module of the page, as source text. */
const pageSources = import.meta.glob<string>(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
);

/** Every module of the plugin, tests and the dev harness included. */
const allSources = import.meta.glob<string>(['../../**/*.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * The plugin's own styles. The dev harness is left out: its tokens file
 * stands in for the host (it is never bundled), so it holds raw values.
 */
const styleSources = import.meta.glob<string>(
  ['../../**/*.module.css', '!../../dev/**'],
  { query: '?raw', import: 'default', eager: true },
);

/** The modules a source imports: `import … from`, `export … from` and bare `import '…'`. */
function importedModules(source: string): string[] {
  const modules: string[] = [];
  const patterns = [
    /^\s*(?:import|export)\b[^;'"]*?from\s+'([^']+)'/gm,
    /^\s*import\s+'([^']+)'/gm,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      modules.push(match[1]);
    }
  }
  return modules;
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '');

describe('imports', () => {
  it('finds the modules', () => {
    expect(Object.keys(pageSources).length).toBeGreaterThan(20);
    expect(Object.keys(allSources).length).toBeGreaterThan(
      Object.keys(pageSources).length,
    );
  });

  it('never imports engine internals from the page', () => {
    for (const [file, source] of Object.entries(pageSources)) {
      const engine = importedModules(source).filter((from) =>
        /\/(selection|replacement)(\/|$)/.test(from),
      );
      expect({ file, engine }).toEqual({ file, engine: [] });
    }
  });

  it('imports each kit component from its own path, never from the package root', () => {
    for (const [file, source] of Object.entries(allSources)) {
      const root = importedModules(source).filter(
        (from) => from === 'datocms-react-ui',
      );
      expect({ file, root }).toEqual({ file, root: [] });
    }
  });
});

describe('styles', () => {
  it('finds the CSS modules', () => {
    expect(Object.keys(styleSources).length).toBeGreaterThan(3);
  });

  it('paints only with semantic tokens: no raw colors, 2.x variables or primitive ramps', () => {
    const forbidden = [
      /#[0-9a-f]{3,8}\b/i,
      /\b(?:rgba?|hsla?)\(/i,
      // The 2.x variables of datocms-react-ui.
      /--(?:accent|primary|light|dark|border|light-bg|lighter-bg|semi-transparent-accent|base-body|light-body|alert|warning|notice|add|remove)-color\b/,
      // Primitive ramps: the tokens are built on them, never painted with.
      /--(?:wash|pigment|red|orange|yellow|green|blue|purple|pink|gray|grey|neutral)-[\w-]+/,
    ];
    for (const [file, source] of Object.entries(styleSources)) {
      const code = withoutComments(source);
      const hits = forbidden
        .map((pattern) => pattern.exec(code)?.[0])
        .filter(Boolean);
      expect({ file, hits }).toEqual({ file, hits: [] });
    }
  });
});
