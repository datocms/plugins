Optional Proxies for OpenAI, Google, and Anthropic
===================================================

You can optionally route API calls through your own proxy for OpenAI, Google (Gemini), and Anthropic. This is useful for:

- Adding CORS headers for browser clients (DatoCMS plugin runs in the browser)
- Centralized logging/observability, egress control, or retries
- Hiding raw upstream URLs behind your domain

How the plugin calls your proxy
--------------------------------

When a Proxy URL is configured under Settings → Vendor → Advanced Options, the plugin sends requests to these paths on your proxy:

- OpenAI: `<Proxy URL>/v1/*` (e.g., `/v1/chat/completions`)
- Anthropic: `<Proxy URL>/v1/*` (e.g., `/v1/messages`)
- Google (Gemini): `<Proxy URL>/v1beta/*` (e.g., `/v1beta/models/{model}:generateContent`)

Your proxy should forward those requests verbatim to the corresponding upstream vendor endpoint and return the response, adding appropriate CORS headers.

Minimal proxy requirements
--------------------------

- Add CORS: at least `Access-Control-Allow-Origin` and `Access-Control-Allow-Headers` for browser requests.
- Forward method, headers, and body to the vendor API, and pass the response back unchanged.
- For streaming endpoints (OpenAI Chat Completions stream), ensure your platform supports streaming/flush.

Security notes
--------------

- If you inject API keys server‑side, do not log headers or bodies that could contain secrets. Restrict CORS to expected origins in production (e.g., `https://admin.datocms.com`).
- If you prefer, you can simply pass through the browser’s Authorization headers to your proxy (keys still stay client‑side). For highest security, terminate auth at the proxy and avoid passing secrets from the browser.

Example: Cloudflare Workers (generic forwarder)
-----------------------------------------------

This example shows a simple forwarder that proxies to an upstream base and adds permissive CORS. You can deploy one Worker per vendor (OpenAI, Anthropic, Gemini) by setting `UPSTREAM_BASE` accordingly.

Environment vars:

- `UPSTREAM_BASE` — e.g., `https://api.openai.com` or `https://api.anthropic.com` or `https://generativelanguage.googleapis.com`
- Optional: `INJECT_AUTH` — when set, adds your Authorization header. Otherwise, the Worker passes through headers from the client.

```
export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(req.url);
    const upstream = new URL(url.pathname + url.search, env.UPSTREAM_BASE);
    const init = {
      method: req.method,
      headers: new Headers(req.headers),
      body: ['GET','HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
    };

    // Optionally inject auth on the server
    if (env.INJECT_AUTH) {
      init.headers.set('Authorization', env.INJECT_AUTH);
      init.headers.delete('x-goog-api-key'); // if using header form for Gemini
    }

    const resp = await fetch(upstream, init);
    const headers = new Headers(resp.headers);
    headers.set('Access-Control-Allow-Origin', cors['Access-Control-Allow-Origin']);
    headers.set('Access-Control-Allow-Headers', cors['Access-Control-Allow-Headers']);
    return new Response(resp.body, { status: resp.status, headers });
  }
}
```

Testing from the plugin
-----------------------

- Use the “Test proxy” button under each vendor’s Advanced Options to verify connectivity quickly.
- If you see CORS errors in the browser console, adjust your proxy’s CORS settings or deployment protection configuration.

Notes
-----

- DeepL uses the built-in DatoCMS CORS proxy (`cors-proxy.datocms.com`) automatically, so no custom proxy setup is required. Simply provide your DeepL API key in the plugin settings.
- For OpenAI, the plugin uses the official SDK when a proxy is set, with `baseURL` pointing at your proxy (`<Proxy>/v1`).
- For Gemini and Anthropic, the plugin uses `fetch` when a proxy is set and targets the REST endpoints described above.

