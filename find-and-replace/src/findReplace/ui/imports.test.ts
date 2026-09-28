import { describe, expect, it } from 'vitest';

/** Every module of the page and of the shared UI primitives, as source text. */
const pageSources = import.meta.glob<string>(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
);
const primitiveSources = import.meta.glob<string>(
  ['../../ui/**/*.{ts,tsx}', '!../../ui/**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
);

const styleSources = import.meta.glob<string>(
  ['../../ui/*.css', '../../kit-fixes.css'],
  { query: '?raw', import: 'default', eager: true },
);

/** The only kit exports the page uses (SPEC §5.2); Button comes from src/ui/Button. */
const ALLOWED_KIT_NAMES = new Set([
  'Canvas',
  'Toolbar',
  'ToolbarStack',
  'ToolbarTitle',
  'TextInput',
  'Spinner',
  'Tooltip',
  'TooltipTrigger',
  'TooltipContent',
  'TooltipProps',
  'Dropdown',
  'DropdownMenu',
  'DropdownOption',
  'DropdownSeparator',
  'CaretDownIcon',
  'CaretUpIcon',
]);

type Import = { names: string[]; from: string };

function importsOf(source: string): Import[] {
  const imports: Import[] = [];
  const pattern = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+'([^']+)'/g;
  for (const match of source.matchAll(pattern)) {
    const clause = match[1];
    const names = (clause.match(/\{([\s\S]*)\}/)?.[1] ?? '')
      .split(',')
      .map((name) =>
        name
          .replace(/^\s*type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .filter(Boolean);
    imports.push({ names, from: match[2] });
  }
  return imports;
}

describe('page imports', () => {
  it('finds the page modules', () => {
    expect(Object.keys(pageSources).length).toBeGreaterThan(20);
  });

  it('uses only the allowed kit components and the Button wrapper', () => {
    for (const [file, source] of Object.entries(pageSources)) {
      for (const { names, from } of importsOf(source)) {
        if (from === 'datocms-react-ui') {
          const unexpected = names.filter(
            (name) => !ALLOWED_KIT_NAMES.has(name),
          );
          expect({ file, unexpected }).toEqual({ file, unexpected: [] });
        }
      }
    }
  });

  it('never imports engine internals', () => {
    for (const [file, source] of Object.entries({
      ...pageSources,
      ...primitiveSources,
    })) {
      const engine = importsOf(source).filter(({ from }) =>
        /\/(selection|replacement)(\/|$)/.test(from),
      );
      expect({ file, engine }).toEqual({ file, engine: [] });
    }
  });

  it('keeps colors in tokens: no hex, rgb or hsl in the styles and primitives', () => {
    const sources = { ...styleSources, ...primitiveSources };
    expect(Object.keys(styleSources)).toHaveLength(2);
    for (const [file, source] of Object.entries(sources)) {
      if (file.endsWith('icons.tsx')) {
        continue;
      }
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
      const hit =
        /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|--accent-color|--primary-color/i.test(
          code,
        );
      expect({ file, hit }).toEqual({ file, hit: false });
    }
  });
});
