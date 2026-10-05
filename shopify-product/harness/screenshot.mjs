#!/usr/bin/env node
/**
 * Captures a harness URL to a PNG with the local Google Chrome, headless.
 *
 *   node harness/screenshot.mjs <url> <out.png> [width] [height]
 *
 * <url> is a full harness URL, or just its query (`?surface=example&scheme=dark`),
 * which is resolved against HARNESS_URL (default http://localhost:5179/index.html).
 * Width defaults to 1280 and never goes below 500: headless Chrome lays out
 * narrower windows at 500px and crops the shot. Height defaults to 900.
 *
 * The URL gets `still=1` (no CSS transitions in the frames) unless it already
 * has `still`: headless Chrome never advances a frame's animation timeline,
 * so a control that just changed state would be shot mid-transition.
 *
 * Environment:
 *   CHROME_PATH       Chrome binary (default: /Applications/Google Chrome.app/…)
 *   HARNESS_URL       Base URL for query-only arguments
 *   HARNESS_BUDGET    --virtual-time-budget in ms (default 8000): how long the
 *                     page may settle (timers, Shopify calls) before the shot
 *   HARNESS_TIMEOUT   Give up after this many ms (default 60000)
 *   HARNESS_SCALE     Device scale factor (default 1)
 *   HARNESS_CONSOLE=1 Print the page's console messages (from every frame)
 *   HARNESS_STILL=0   Keep CSS transitions (don't add `still=1`)
 *
 * On macOS, headless Chrome writes the PNG and then may never exit, so the
 * script stops it as soon as Chrome reports the file as written.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const MIN_WIDTH = 500;
const DEFAULT_CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_BASE = 'http://localhost:5179/index.html';
const KILL_GRACE_MS = 2000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage(message) {
  fail(
    `${message ? `${message}\n` : ''}Usage: node harness/screenshot.mjs <url> <out.png> [width] [height]`,
  );
}

function readNumber(value, fallback, name) {
  if (value === undefined || value === '') {
    return fallback;
  }
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) {
    usage(`Invalid ${name}: ${value}`);
  }
  return number;
}

/** Adds `still=1` unless the URL sets `still` or HARNESS_STILL=0. */
function withStill(url) {
  if (process.env.HARNESS_STILL === '0') {
    return url;
  }
  const parsed = new URL(url);
  if (!parsed.searchParams.has('still')) {
    parsed.searchParams.set('still', '1');
  }
  return parsed.toString();
}

function readArgs(argv) {
  const [rawUrl, rawOut, rawWidth, rawHeight] = argv;
  if (!rawUrl || !rawOut) {
    usage();
  }
  const base = process.env.HARNESS_URL ?? DEFAULT_BASE;
  const url = withStill(rawUrl.startsWith('?') ? `${base}${rawUrl}` : rawUrl);
  let width = readNumber(rawWidth, 1280, 'width');
  if (width < MIN_WIDTH) {
    console.warn(
      `Width ${width} is below ${MIN_WIDTH}px; using ${MIN_WIDTH} (crop the PNG afterwards).`,
    );
    width = MIN_WIDTH;
  }
  return {
    url,
    out: resolve(rawOut),
    width,
    height: readNumber(rawHeight, 900, 'height'),
    budget: readNumber(process.env.HARNESS_BUDGET, 8000, 'HARNESS_BUDGET'),
    timeout: readNumber(process.env.HARNESS_TIMEOUT, 60000, 'HARNESS_TIMEOUT'),
    printConsole: process.env.HARNESS_CONSOLE === '1',
  };
}

function chromeArgs(options, profileDir) {
  return [
    '--headless=new',
    '--hide-scrollbars',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--use-mock-keychain',
    `--user-data-dir=${profileDir}`,
    `--force-device-scale-factor=${process.env.HARNESS_SCALE ?? '1'}`,
    `--window-size=${options.width},${options.height}`,
    `--virtual-time-budget=${options.budget}`,
    `--screenshot=${options.out}`,
    // Console messages go to stderr only with logging on.
    ...(options.printConsole ? ['--enable-logging=stderr', '--v=0'] : []),
    options.url,
  ];
}

function printConsole(stderr) {
  for (const line of stderr.split('\n')) {
    const match = line.match(/:CONSOLE(?:\(\d+\)|:\d+)\] (.*)$/);
    if (match) {
      console.log(`[page] ${match[1]}`);
    }
  }
}

function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, KILL_GRACE_MS).unref();
}

function capture(options) {
  const chrome = process.env.CHROME_PATH ?? DEFAULT_CHROME;
  mkdirSync(dirname(options.out), { recursive: true });
  rmSync(options.out, { force: true });
  // A throwaway profile, so the capture never touches a running Chrome.
  const profileDir = mkdtempSync(join(tmpdir(), 'harness-chrome-'));
  const child = spawn(chrome, chromeArgs(options, profileDir), {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  let written = false;
  const timer = setTimeout(() => stop(child), options.timeout);
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (!written && /bytes written to file/.test(stderr)) {
      written = true;
      stop(child);
    }
  });
  child.on('error', (error) => {
    clearTimeout(timer);
    rmSync(profileDir, { recursive: true, force: true });
    fail(`Could not start Chrome at ${chrome}: ${error.message}`);
  });
  child.on('close', () => {
    clearTimeout(timer);
    rmSync(profileDir, { recursive: true, force: true });
    if (options.printConsole) {
      printConsole(stderr);
    }
    if (!written || !existsSync(options.out)) {
      fail(`No screenshot was written.\n${stderr.trim()}`);
    }
    console.log(
      `Saved ${options.out} (${options.width}×${options.height}) from ${options.url}`,
    );
  });
}

/** Fails fast when the dev server is down, instead of capturing Chrome's error page. */
async function assertReachable(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      fail(`${url} answered HTTP ${response.status}. Is the harness dev server running?`);
    }
  } catch (error) {
    fail(
      `Couldn't reach ${url} (${error.message}). Start the harness with: npx vite --config harness/vite.config.ts --port 5179 --strictPort`,
    );
  }
}

const options = readArgs(process.argv.slice(2));
await assertReachable(options.url);
capture(options);
