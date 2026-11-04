/**
 * Mints a DatoCMS Remote MCP access token for the live tests and saves it as
 * `E2E_MCP_ACCESS_TOKEN` in `e2e/.env.local`. It runs the same OAuth flow as the
 * plugin (dynamic client registration, PKCE, consent at oauth.datocms.com), with a
 * loopback redirect that the browser never actually reaches.
 *
 * The token reaches only the seed project, with "Read and edit content" access.
 * Pass `--anything` for schema-changing tests and `--project <name>` for
 * another project.
 *
 * Usage, from the plugin folder:
 *   node e2e/setup/mcp-login.ts            # headed: sign in and authorize by hand
 *   E2E_LOGIN_EMAIL=… E2E_LOGIN_PASSWORD=… node e2e/setup/mcp-login.ts   # headless
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

// Same values as src/lib/oauth.ts (this script runs under plain Node, so it can't import it).
const MCP_RESOURCE = 'https://mcp.datocms.com/';
const OAUTH_BASE_URL = 'https://oauth.datocms.com/oauth';
const SCOPES = 'read_account read_sites read_organizations';
const REDIRECT_URI = 'http://127.0.0.1:53682/callback';
const ENV_FILE = new URL('../.env.local', import.meta.url);

/** Value after a `--flag` on the command line. */
const argument = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const base64Url = (bytes: Buffer) => bytes.toString('base64url');

/** Replaces or appends one `KEY=value` line, keeping the file owner-only. */
function saveEnvValue(key: string, value: string): void {
  const lines = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, 'utf8')
        .split('\n')
        .filter((line) => line && !line.startsWith(`${key}=`))
    : [];
  writeFileSync(ENV_FILE, `${[...lines, `${key}=${value}`].join('\n')}\n`);
  chmodSync(ENV_FILE, 0o600);
}

const registration = await fetch(`${OAUTH_BASE_URL}/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_name: 'DatoCMS Agent Plugin (live tests)',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: SCOPES,
  }),
});
if (!registration.ok)
  throw new Error(`Client registration failed: ${registration.status}`);
const { client_id: clientId } = (await registration.json()) as {
  client_id: string;
};

const codeVerifier = base64Url(randomBytes(32));
const state = base64Url(randomBytes(32));
const authorizationUrl = `${OAUTH_BASE_URL}/authorize?${new URLSearchParams({
  client_id: clientId,
  response_type: 'code',
  resource: MCP_RESOURCE,
  redirect_uri: REDIRECT_URI,
  code_challenge: base64Url(createHash('sha256').update(codeVerifier).digest()),
  code_challenge_method: 'S256',
  state,
  scope: SCOPES,
})}`;

const projectName = argument('--project') ?? 'claude-e2e-dato-agent';
const isAnything = process.argv.includes('--anything');
const email = process.env.E2E_LOGIN_EMAIL;
const password = process.env.E2E_LOGIN_PASSWORD;
const isHeadless = Boolean(email && password);
const browser = await chromium.launch({
  channel: 'chromium',
  headless: isHeadless,
});
const page = await browser.newPage();

// The loopback redirect carries the code; answer it here instead of running a server.
const callback = new Promise<URL>((resolve) => {
  void page.route(`${new URL(REDIRECT_URI).origin}/**`, async (route) => {
    resolve(new URL(route.request().url()));
    await route.fulfill({
      contentType: 'text/html',
      body: '<p>Signed in. You can close this window.</p>',
    });
  });
});

await page.goto(authorizationUrl);
if (isHeadless && email && password) {
  const authorize = page.getByRole('button', { name: 'Authorize' });
  await page
    .getByLabel('Email')
    .or(authorize)
    .first()
    .waitFor({ timeout: 30_000 });
  if (await page.getByLabel('Email').count()) {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByLabel('Password').press('Enter');
  }
  await authorize.waitFor({ timeout: 30_000 });
  // Least privilege: only the seed project, content edits only unless --anything.
  await page.getByRole('radio', { name: /^Only selected projects/ }).check();
  await page.getByRole('button', { name: 'Select projects…' }).click();
  await page.getByRole('textbox', { name: 'Filter projects…' }).fill(projectName);
  await page.getByRole('checkbox', { name: projectName, exact: true }).check();
  await page.keyboard.press('Escape');
  await page
    .getByRole('radio', {
      name: isAnything ? /^Anything you can/ : /^Read and edit content/,
    })
    .check();
  await authorize.click({ timeout: 30_000 });
} else {
  console.log(
    `In the browser window: sign in, pick "Only selected projects" → ${projectName}, pick "${isAnything ? 'Anything you can' : 'Read and edit content'}", then click Authorize.`,
  );
}

const redirected = await Promise.race([
  callback,
  new Promise<never>((_, reject) =>
    setTimeout(async () => {
      // Shows where the flow stopped, e.g. an unexpected consent or project picker.
      const screenshot = `${tmpdir()}/dato-agent-mcp-login-failure.png`;
      await page.screenshot({ path: screenshot }).catch(() => undefined);
      reject(new Error(`No OAuth redirect after 2 minutes at ${new URL(page.url()).pathname}. See ${screenshot}`));
    }, 120_000),
  ),
]);
await browser.close();
if (redirected.searchParams.get('state') !== state)
  throw new Error('OAuth state mismatch');
const code = redirected.searchParams.get('code');
if (!code)
  throw new Error(
    `Authorization failed: ${redirected.searchParams.get('error') ?? 'no code'}`,
  );

const tokenResponse = await fetch(`${OAUTH_BASE_URL}/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    resource: MCP_RESOURCE,
    code,
    client_id: clientId,
    code_verifier: codeVerifier,
    redirect_uri: REDIRECT_URI,
  }),
});
if (!tokenResponse.ok)
  throw new Error(`Token exchange failed: ${tokenResponse.status}`);
const token = (await tokenResponse.json()) as {
  access_token: string;
  expires_in?: number;
};
saveEnvValue('E2E_MCP_ACCESS_TOKEN', token.access_token);
console.log(
  `Saved E2E_MCP_ACCESS_TOKEN to e2e/.env.local${token.expires_in ? ` (expires in ${Math.round(token.expires_in / 3600)} h)` : ''}.`,
);
