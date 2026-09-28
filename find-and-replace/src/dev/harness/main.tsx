// Runs inside the preview frame (frame.html). Same CSS order as src/main.tsx.
import 'datocms-react-ui/styles.css';
import '../../kit-fixes.css';
import '../../ui/recipes.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import FindReplacePage from '../../entrypoints/FindReplacePage';
import type { FindReplaceController } from '../../findReplace/contract';
import { devHooks } from '../../findReplace/devHooks';
import { buildCtx, type ColorScheme, readConfirmAnswer } from './ctx';
import tokensCss from './datocms-tokens.css?raw';
import { getScenario, readScenarioName } from './fakeCma/scenarios';
import { type FakeCma, installFakeCma } from './fakeCma/server';
import { Gallery } from './gallery';
import { resolveDesignTokens } from './tokens';

declare global {
  interface Window {
    /** The fake backend, for poking at it from the console. */
    __harnessCma?: FakeCma;
  }
}

const params = new URLSearchParams(window.location.search);
const scheme: ColorScheme = params.get('scheme') === 'dark' ? 'dark' : 'light';
const scenario = getScenario(readScenarioName(params.get('scenario')));
const confirmAnswer = readConfirmAnswer(params.get('confirm'));
const view = params.get('view') === 'states' ? 'states' : 'page';

// What connect() does on <html>: the kit, light-dark() and native controls rely on it.
document.documentElement.dataset.colorScheme = scheme;
document.documentElement.style.colorScheme = scheme;
document.body.style.margin = '0';

const cssDesignTokens = resolveDesignTokens(tokensCss, scheme);

function readMs(name: 'latency' | 'jitter'): number | undefined {
  const value = Number.parseInt(params.get(name) ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

if (view === 'page') {
  window.__harnessCma = installFakeCma(scenario.name, {
    latency: readMs('latency'),
    jitter: readMs('jitter'),
  });

  // ?q= and ?r= prefill the page as soon as a controller exists.
  const pattern = params.get('q');
  const replacement = params.get('r');
  if (pattern || replacement) {
    devHooks.onController = (controller: FindReplaceController) => {
      if (pattern) {
        controller.setPattern(pattern);
        controller.searchNow();
      }
      if (replacement) controller.setReplacementText(replacement);
    };
  }
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}
const root = createRoot(container);

/** Renders with a fresh ctx object; the host's "New ctx" button calls it again. */
function render(): void {
  const ctx = buildCtx({
    scenario,
    scheme,
    cssDesignTokens,
    confirm: confirmAnswer,
  });
  root.render(
    <StrictMode>
      {view === 'states' ? (
        <Gallery ctx={ctx} state={params.get('state')} />
      ) : (
        <FindReplacePage ctx={ctx} />
      )}
    </StrictMode>,
  );
}

window.__harnessNewCtx = render;
render();
