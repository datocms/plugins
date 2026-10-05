# Preview harness

A dev-only page that renders the plugin's real entrypoint components outside
DatoCMS, with a mock `ctx`, in light and dark mode, inside an iframe sized like
the dashboard's. Use it to review and screenshot every surface and state
without installing the plugin in a project. It follows section 17 of the
DatoCMS design-language plugin reference ("Previewing plugin UI outside
DatoCMS").

It is never part of the production build: `npm run build` uses the root
`vite.config.ts` and `index.html`, and `tsconfig.app.json` only covers `src`
and `tests`. `harness/tsconfig.json` exists for editor support and for
`npx tsc -p harness/tsconfig.json --noEmit`.

## Run it

```bash
npm run harness          # http://localhost:5179/
# or, in the background on a fixed port:
npx vite --config harness/vite.config.ts --port 5179 --strictPort
```

The toolbar picks the surface and state, the color scheme and the frame width.
Under the stage, **Mock state** shows what the plugin wrote: the field value at
`ctx.fieldPath`, the plugin parameters, or the field config parameters and
errors.

## URL contract

`index.html?surface=<id>&state=<name>&scheme=light|dark&width=<px>`

| Parameter | Meaning |
|---|---|
| `surface` | A surface id. Defaults to the first one |
| `state` | One of the surface's named states. Defaults to its first state |
| `scheme` | `light` (default) or `dark` |
| `width` | Iframe width in px, overriding the kind's default |
| `bare=1` | Hide the toolbar and inspector, for clean screenshots |
| `confirm=cancel` | `ctx.openConfirm` answers cancel instead of the first choice |
| `still=1` | No CSS transitions in the frames (`screenshot.mjs` adds it; `HARNESS_STILL=0` opts out). Headless Chrome never advances a frame's animation timeline, so a control that just changed state would be shot mid-transition |

## What the host reproduces

| Kind | Hook | Frame width (default) | Body padding | Behind the frame | Host chrome |
|---|---|---|---|---|---|
| `config` | `renderConfigScreen` | 650 + 2 × 30 = 710 | 30 | `--color--surface` | Ruled "Plugin settings" title |
| `fieldConfig` | `renderManualFieldExtensionConfigScreen` | 600 + 2 × 10 = 620 | 10 | `--color--surface-raised` | Bordered box with an uppercase title, red when `ctx.errors` has entries |
| `field` | `renderFieldExtension` | 800 + 2 × 10 = 820, or narrow 500 + 2 × 10 = 520 | 10 | `--color--surface` (`background: 'raised'` for blocks) | The field label |
| `modal` | `renderModal` | panel − 2 × 24 + 2 × 20, so `xl` 1010 → 1002 | 20 | `--color--surface-raised` panel on the backdrop | Title bar when given, ✕ |

- The iframe is pulled outward by the body padding (negative margins), and
  `<Canvas>` pads it back in, so content lines up with the host label.
- The frame grows with its content: `startAutoResizer` measures like the SDK
  (ResizeObserver plus MutationObserver, including the lowest element bottom)
  and sets the iframe height. `isAutoResizerActive`, `updateHeight` and
  `setHeight` work too.
- Tokens: the host page loads `datocms-tokens.css` (a copy of the skill's
  `assets/datocms-tokens.css`) on its own `<html>`. The frame resolves
  `ctx.cssDesignTokens` the way the dashboard does (`tokens.ts`), in a separate
  hidden document, so the frame itself only gets the 119 tokens through ctx and
  portals that escape `<Canvas>` look as broken here as they would in DatoCMS.
- The frame sets `data-color-scheme` and `color-scheme` on its `<html>`, as
  `connect()` does. It never calls `connect()`.

## The mock ctx

`mockCtx.ts` builds a fresh ctx for every render from an in-memory store, as
the SDK hands a new ctx object to every render. Every ctx has `mode`,
`bodyPadding`, `cssDesignTokens`, `colorScheme`, `theme: {}`, `plugin`
(name "Shopify product", parameters), `site`, `environment: 'main'`,
`isEnvironmentPrimary`, `currentUser`, `currentRole`, `ui.locale`, the
`itemTypes`/`fields` maps, the sizing methods, and every base method.

| Call | What happens |
|---|---|
| `setFieldValue(path, value)` | Updates `formValues` (and `isFormDirty`), then re-renders |
| `updatePluginParameters(params)` | Saves into `plugin.attributes.parameters`, then re-renders |
| `setParameters(params)` (field config) | Saves into `ctx.parameters`, recomputes `ctx.errors`, re-renders |
| `openModal({ id, width, parameters, … })` | The host opens a second frame over a backdrop, rendering the `modal` surface whose `id` matches (the picker is `shopifyPicker`). Its `ctx.resolve(value)` settles the original promise; ✕ and Esc resolve `null` |
| `openConfirm(options)` | Resolves the first choice's value (`confirm=cancel` for the cancel value) and logs |
| `notice` / `alert` / `customToast` | A toast in the host page (and `customToast` resolves the CTA value) |
| `navigateTo`, `selectItem`, `editUpload`, `updateFieldAppearance`, … | Log to the console and as a small toast; dialogs resolve `null` |

Defaults: plugin parameters are v3 with the demo store on
(`{ paramsVersion: '3', stores: [], useDemoStore: true, autoApplyToFieldsWithApiKey: '' }`),
the field is a JSON field with API key `shopify_product` and empty appearance
parameters (a 1.x field), the value is `null`, and the role can edit the
schema.

Every ctx is a Proxy: reading a property the mock doesn't define logs
`[harness] ctx.<name> is not mocked …` once, so missing mocks are obvious.
Add what's missing to `mockCtx.ts`.

Values that cross frames (modal parameters, resolved values, toasts) are
cloned into the receiving frame with `structuredClone`, like a `postMessage`.

## Add a surface

Create `harness/surfaces/<name>.tsx` and default-export a surface. The
registry finds it with `import.meta.glob`; nothing else changes.

```tsx
// harness/surfaces/field-extension.tsx
import FieldExtension from '../../src/entrypoints/FieldExtension';
import { defineSurface } from '../surface';

export default defineSurface({
  id: 'field-extension',
  title: 'Field editor',
  kind: 'field',
  states: {
    empty: {
      fieldParameters: {
        paramsVersion: '1',
        kind: 'product',
        cardinality: 'multiple',
        format: 'reference',
        snapshot: false,
      },
    },
    'legacy-handle': { fieldType: 'string', value: 'the-complete-snowboard' },
    // JSON fields hold a JSON string in formValues, as in the dashboard.
    'legacy-json': { value: JSON.stringify({ id: 'gid://shopify/Product/1', handle: 'x' }) },
    disabled: { fieldType: 'string', value: 'the-complete-snowboard', disabled: true },
    'not-configured': {
      pluginParameters: {
        paramsVersion: '3',
        stores: [],
        useDemoStore: false,
        autoApplyToFieldsWithApiKey: '',
      },
    },
  },
  render: (ctx) => <FieldExtension ctx={ctx()} />,
});
```

- `kind` decides the ctx type `render` receives: `config` →
  `RenderConfigScreenCtx`, `fieldConfig` →
  `RenderManualFieldExtensionConfigScreenCtx`, `field` →
  `RenderFieldExtensionCtx`, `modal` → `RenderModalCtx`.
- `render(ctx, state)`: call `ctx()` once per render for a fresh ctx;
  `ctx({ … })` spreads overrides over it. `state` is the resolved state with
  its `name`.
- `states` are named presets, in picker order; the first is the default. Keys
  (all optional, see `surface.ts`): `description`, `pluginParameters`,
  `fieldType` (`'string'` or `'json'`), `fieldParameters`, `value`,
  `disabled`, `localized`, `apiKey`, `fieldLabel`, `errors`, `uiLocale`,
  `canEditSchema`, `modalParameters`, `modalWidth`, `modalTitle`,
  `initialHeight`, `background` (`'surface'` or `'raised'`).
- `fieldConfig` surfaces can add `validate(parameters)`, which runs on every
  render to produce `ctx.errors`, standing in for
  `validateManualFieldExtensionParameters`.
- A `modal` surface's `id` is the modal id. The picker surface must use
  `id: 'shopifyPicker'` so `ctx.openModal({ id: 'shopifyPicker' })` from the
  field editor opens it. Shown on its own (`?surface=shopifyPicker`), it uses
  the state's `modalParameters`, `modalWidth` (default `xl`) and `modalTitle`,
  and `ctx.resolve` logs the value into Mock state.
- Every surface module is imported eagerly by both pages, so one broken
  surface file breaks the harness until it compiles again. A render crash is
  shown inside the frame.
- `example.tsx` and `example-modal.tsx` are self-tests of the harness itself
  (field editor plus modal round trip); keep them working.

## Screenshots

With the dev server running:

```bash
node harness/screenshot.mjs '<url or ?query>' <out.png> [width] [height]

node harness/screenshot.mjs '?surface=example&state=with-value&scheme=dark&bare=1' \
  /tmp/harness-shots/example-dark.png 920 400
```

- A query-only argument is resolved against `HARNESS_URL`
  (default `http://localhost:5179/index.html`).
- It runs `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  (`CHROME_PATH` overrides it) with `--headless=new --hide-scrollbars
  --window-size=W,H --virtual-time-budget=… --screenshot=…` and a throwaway
  profile. Chrome on macOS writes the PNG and then may not exit, so the script
  stops it once Chrome reports the file as written.
- Width defaults to 1280 and never goes below 500: headless Chrome lays out
  narrower windows at 500px and crops the shot. Keep narrow frames inside a
  wider window and crop afterwards.
- Windows that fit each kind with `bare=1` (40px stage padding): config
  ~800 wide, field ~920 (narrow ~620), field config ~760, `xl` modal ~1100.
- `HARNESS_BUDGET` (default 8000) is the virtual time the page gets to settle,
  including live Storefront calls to the demo store; raise it if a shot shows
  a loading state. `HARNESS_SCALE=2` takes retina shots. `HARNESS_CONSOLE=1`
  prints every frame's console output, including the missing-mock warnings.
- `harness/screenshots/` is git-ignored.
