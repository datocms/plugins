/**
 * Provider response capture toolkit.
 *
 * Runs a battery of realistic translation requests against the providers whose
 * keys are present in the environment, and writes SANITIZED raw response
 * envelopes to test/fixtures/provider-responses/<provider>/<scenario>.json.
 *
 * These fixtures ground our parser/QC tests in real-world response shapes
 * (truncation, over-split, fenced/prose output, structured output, multi-block
 * HTML, DeepL native array) instead of guessed ones.
 *
 * Usage (keys never printed; .env.testing is gitignored):
 *   node --env-file=.env.testing test/capture-provider-responses.mjs
 *
 * Env vars: OPENAI, GEMINI, DEEPL (bare keys). Optional overrides:
 *   OPENAI_MODEL (default gpt-4o-mini), GEMINI_MODEL (default gemini-2.5-flash),
 *   CAPTURE_TO (default 'fr'), CAPTURE_FROM (default 'en').
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

const OUT_DIR = 'test/fixtures/provider-responses';
const FROM = process.env.CAPTURE_FROM ?? 'en';
const TO = process.env.CAPTURE_TO ?? 'fr';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

/** The plugin's real (hardened) chat instruction, kept in sync intentionally. */
const HARDENED_INSTRUCTION = `Translate the following array of strings from ${FROM} to ${TO}. Return ONLY a valid JSON array of the exact same length, with a strict one-to-one mapping: each input string maps to exactly one output string. NEVER split a single input string into multiple array elements and never merge multiple inputs into one, even when a string contains newlines or multiple HTML blocks like <p>…</p><p>…</p> — translate the whole string as one element. Preserve placeholders like {foo}, {{bar}}, and tokens like ⟦PH_0⟧. Do not explain.`;

/** A naive instruction (no anti-split guard) to ground the over-split failure mode. */
const NAIVE_INSTRUCTION = `Translate the following array of strings from ${FROM} to ${TO}. Return a JSON array of the translations.`;

/**
 * Two-paragraph WYSIWYG HTML modeled on the reported cropping bug (over-split
 * repro) — fictional hotel/place names, no real customer data.
 */
const MULTIBLOCK_HTML = `<p data-path-to-node="0">Harbor View Lodge sits in the Saltmere Quarter, a short walk from the Marlow Avenue shops and the old harbor. The hotel is about 1.5 kilometres from Eastport Central station, roughly a 20-minute walk or a 10-minute ride on tram lines 2 or 6 to Brindle Square.</p>\n<p data-path-to-node="1">The property has a relaxed, practical design with an open lobby that doubles as a lounge and cafe. Rooms are compact and tidy, with walk-in showers and motion-activated lighting. Some include a small balcony over the canal. Facilities include a 24-hour gym and a quiet reading nook. The building carries a regional eco certification for low energy use and follows a water-saving programme with plant-based cleaning supplies.</p>`;

/** A segment carrying placeholders/ICU to check token preservation. */
const PLACEHOLDER_SEGMENT =
  'Welcome {{name}}, you have %s new messages about :topic.';

/** Fictional, realistic translatable strings (no real/customer data). */
const REAL = [
  'Grow your team with smarter workflow tools',
  'Automate routine tasks, surface insights in real time, and keep every project moving forward without the busywork.',
];

/** Strip volatile / identifying fields so fixtures are stable and clean. */
function sanitize(value) {
  const VOLATILE = new Set([
    'id',
    'created',
    'created_at',
    'system_fingerprint',
    'responseId',
    'response_id',
    '_request_id',
    'x-request-id',
    'request_id',
    'organization',
  ]);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (VOLATILE.has(k)) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return value;
}

function save(provider, scenario, payload) {
  const file = join(OUT_DIR, provider, `${scenario}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`  ✓ ${provider}/${scenario}`);
}

/** Run one capture, recording either the response or the error shape. */
async function capture(provider, scenario, request, fn) {
  try {
    const response = await fn();
    save(provider, scenario, {
      provider,
      scenario,
      request,
      ok: true,
      response: sanitize(response),
    });
  } catch (error) {
    // Error shapes are themselves useful fixtures for our error-handling tests.
    const shape = {
      name: error?.name,
      status: error?.status ?? error?.code,
      message: String(error?.message ?? error).slice(0, 500),
      body: sanitize(error?.error ?? error?.response?.data ?? null),
    };
    save(provider, scenario, {
      provider,
      scenario,
      request,
      ok: false,
      error: shape,
    });
  }
}

const arrayPrompt = (instruction, segments) =>
  `${instruction}\n${JSON.stringify(segments)}`;

async function captureOpenAI(key) {
  console.log('OpenAI…');
  const client = new OpenAI({ apiKey: key });
  const call = (body) => client.chat.completions.create(body);
  const msg = (content) => ({
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content }],
    stream: false,
  });

  await capture(
    'openai',
    'array-baseline',
    { model: OPENAI_MODEL, segments: REAL },
    () => call(msg(arrayPrompt(HARDENED_INSTRUCTION, REAL))),
  );
  await capture(
    'openai',
    'truncated',
    { model: OPENAI_MODEL, max_tokens: 8 },
    () => call({ ...msg(arrayPrompt(HARDENED_INSTRUCTION, REAL)), max_tokens: 8 }),
  );
  await capture(
    'openai',
    'html-multiblock-naive',
    { model: OPENAI_MODEL, instruction: 'naive', segments: [MULTIBLOCK_HTML] },
    () => call(msg(arrayPrompt(NAIVE_INSTRUCTION, [MULTIBLOCK_HTML]))),
  );
  await capture(
    'openai',
    'html-multiblock-hardened',
    { model: OPENAI_MODEL, instruction: 'hardened', segments: [MULTIBLOCK_HTML] },
    () => call(msg(arrayPrompt(HARDENED_INSTRUCTION, [MULTIBLOCK_HTML]))),
  );
  await capture(
    'openai',
    'placeholders',
    { model: OPENAI_MODEL, segments: [PLACEHOLDER_SEGMENT] },
    () => call(msg(arrayPrompt(HARDENED_INSTRUCTION, [PLACEHOLDER_SEGMENT]))),
  );
  await capture(
    'openai',
    'structured-output',
    { model: OPENAI_MODEL, response_format: 'json_schema(object items)' },
    () =>
      call({
        ...msg(arrayPrompt(HARDENED_INSTRUCTION, REAL)),
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'translations',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: REAL.map((_, i) => String(i)),
              properties: Object.fromEntries(
                REAL.map((_, i) => [String(i), { type: 'string' }]),
              ),
            },
          },
        },
      }),
  );
}

async function captureGemini(key) {
  console.log('Gemini…');
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  const req = (prompt, generationConfig) => ({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(generationConfig ? { generationConfig } : {}),
  });
  const run = async (request) => {
    const result = await model.generateContent(request);
    return JSON.parse(JSON.stringify(result.response));
  };

  await capture('gemini', 'array-baseline', { model: GEMINI_MODEL, segments: REAL }, () =>
    run(req(arrayPrompt(HARDENED_INSTRUCTION, REAL))),
  );
  await capture(
    'gemini',
    'truncated',
    { model: GEMINI_MODEL, maxOutputTokens: 8 },
    () => run(req(arrayPrompt(HARDENED_INSTRUCTION, REAL), { maxOutputTokens: 8 })),
  );
  await capture(
    'gemini',
    'html-multiblock-naive',
    { model: GEMINI_MODEL, instruction: 'naive', segments: [MULTIBLOCK_HTML] },
    () => run(req(arrayPrompt(NAIVE_INSTRUCTION, [MULTIBLOCK_HTML]))),
  );
  await capture(
    'gemini',
    'html-multiblock-hardened',
    { model: GEMINI_MODEL, instruction: 'hardened', segments: [MULTIBLOCK_HTML] },
    () => run(req(arrayPrompt(HARDENED_INSTRUCTION, [MULTIBLOCK_HTML]))),
  );
  await capture(
    'gemini',
    'multi-candidate',
    { model: GEMINI_MODEL, candidateCount: 2 },
    () => run(req(arrayPrompt(HARDENED_INSTRUCTION, REAL), { candidateCount: 2 })),
  );
  await capture(
    'gemini',
    'structured-output',
    { model: GEMINI_MODEL, responseSchema: 'ARRAY<STRING> minItems=maxItems=N' },
    () =>
      run(
        req(arrayPrompt(HARDENED_INSTRUCTION, REAL), {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            minItems: REAL.length,
            maxItems: REAL.length,
          },
        }),
      ),
  );
}

async function captureDeepL(key) {
  console.log('DeepL…');
  const base = key.endsWith(':fx')
    ? 'https://api-free.deepl.com'
    : 'https://api.deepl.com';
  const post = async (body) => {
    const res = await fetch(`${base}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { httpStatus: res.status, body: json };
  };

  await capture(
    'deepl',
    'array-baseline',
    { target_lang: TO.toUpperCase(), texts: REAL.length },
    () =>
      post({
        text: REAL,
        target_lang: TO.toUpperCase(),
        show_billed_characters: true,
      }),
  );
  await capture(
    'deepl',
    'html-tag-handling',
    { target_lang: TO.toUpperCase(), tag_handling: 'html' },
    () =>
      post({
        text: [MULTIBLOCK_HTML],
        target_lang: TO.toUpperCase(),
        tag_handling: 'html',
        show_billed_characters: true,
      }),
  );
}

async function main() {
  // Optional CAPTURE_ONLY=openai,gemini,deepl filter for targeted re-runs.
  const only = (process.env.CAPTURE_ONLY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const want = (p) => only.length === 0 || only.includes(p);
  console.log(`Capturing ${FROM}→${TO} into ${OUT_DIR}/\n`);
  if (want('openai') && process.env.OPENAI) await captureOpenAI(process.env.OPENAI);
  else if (want('openai')) console.log('OpenAI… (skipped)');
  if (want('gemini') && process.env.GEMINI) await captureGemini(process.env.GEMINI);
  else if (want('gemini')) console.log('Gemini… (skipped)');
  if (want('deepl') && process.env.DEEPL) await captureDeepL(process.env.DEEPL);
  else if (want('deepl')) console.log('DeepL… (skipped)');
  console.log('\nDone.');
}

main().catch((error) => {
  console.error('Fatal:', error?.message ?? error);
  process.exitCode = 1;
});
