# Web Previews DatoCMS plugin

This plugin adds side-by-side previews, and quick links in the record sidebar to preview your webpages.

🚨 **Important:** This is not a drag & drop plugin! It requires a lambda function on your frontend website(s) in order to function. Read more in the following sections!

## Installation and configuration

Once the plugin is installed you need to specify:

- A list of frontends. Each frontend specifies a name and a preview webhook, which will be called as soon as the plugin is loaded. Read more about it on the next chapter.
- Sidebar open: to specify whether you want the sidebar panel to be opened by default.

⚠️ For side-by-side previews to work, if your website implements a [Content Security Policy `frame-ancestors` directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP), you need to add `https://plugins-cdn.datocms.com` to your list of allowed sources, ie.:

```
Content-Security-Policy: frame-ancestors 'self' https://plugins-cdn.datocms.com;
```

## The Previews webhook

Each frontend must implement a CORS-ready JSON endpoint that, given a specific DatoCMS record, returns an array of preview link(s).

The plugin performs a POST request to the Previews webhook URL, passing a payload that includes the current environment, record and model:

```json
{
  "item": {…},
  "itemType": {…},
  "currentUser": {…},
  "environmentId": "main",
  "locale": "en",
}
```

- `item`: [CMA entity](https://www.datocms.com/docs/content-management-api/resources/item) of the current record
- `itemType`: [CMA entity](https://www.datocms.com/docs/content-management-api/resources/item-type) of the model of the current record
- `currentUser`: CMA entity of the [collaborator](https://www.datocms.com/docs/content-management-api/resources/user), [SSO user](https://www.datocms.com/docs/content-management-api/resources/sso-user) or [account owner](https://www.datocms.com/docs/content-management-api/resources/account) currently logged in
- `environmentId`: the current environment ID
- `locale`: the locale currently active on the form

The endpoint is expected to return a `200` response, with the following JSON structure:

```json
{
  "previewLinks": [
    {
      "label": "Published (en)",
      "url": "https://mysite.com/blog/my-article"
    },
    {
      "label": "Draft (en)",
      "url": "https://mysite.com/api/preview/start?slug=/blog/my-article"
    }
  ]
}
```

The plugin will show all the preview links that are returned. If you want to make sure that a preview's URL is reloaded after each save, you can include an extra option (please be aware that because of cross-origin iframe issues, maintaining the scroll position between reloads will not be possible):

```json
{
  "label": "Draft (en)",
  "url": "https://mysite.com/api/preview/start?slug=/blog/my-article",
  "reloadPreviewOnRecordUpdate": { "delayInMs": 100 }
}
```

### Implementation examples

If you have built alternative endpoint implementations for other frameworks/SSGs, please open up a PR to this plugin and share it with the community!

#### Next.js

We suggest you look at the code of our [official Next.js Starter Kit](https://github.com/datocms/nextjs-starter-kit):

- Route handler called returning the preview links: [`app/api/preview-links/route.tsx`](https://github.com/datocms/nextjs-starter-kit/blob/main/src/app/api/preview-links/route.tsx)
- Route handlers to toggle Next.js [Draft Mode](https://www.datocms.com/docs/next-js/setting-up-next-js-draft-mode): [`app/api/draft-mode/enable/route.tsx`](https://github.com/datocms/nextjs-starter-kit/blob/main/src/app/api/draft-mode/enable/route.tsx) and [`app/api/draft-mode/disable/route.tsx`](https://github.com/datocms/nextjs-starter-kit/blob/main/src/app/api/draft-mode/disable/route.tsx)

##### Lightweight Authentication

In our Next.js starter kit, the preview link URLs also include a `token` query parameter that the plugin would send to the webhook receiver, like `https://www.mywebsite.com/api/preview-links?token=some-secret-ish-string`. The `token` is a string of your choice that just has to match in both the plugin settings and [in your frontend's environment variables](https://github.com/datocms/nextjs-starter-kit/blob/main/src/app/api/preview-links/route.tsx#L31-L34). While not encryption, this token is an easy way to limit access to your preview content.

#### Nuxt 3

Below here, you'll find a similar example, adapted for Nuxt. For the purpose of this example, let's say we want to return a link to the webpage that contains the published content.

If you deploy on a provider that supports edge functions, Nuxt 3 applications can expose a dynamic API: files in the `/server/api` folders will be converted into endpoints. So it's possible for DatoCMS to make a POST request to the Nuxt app with the info about the current record. What we'll actually do, is to implement a CORS enabled API endpoint returning an array of preview links built on the base of the record, the item type and so on:

```js
// Put this code in the /server/api directory of your Nuxt website (`/server/api/preview-links.ts` will work):
// this function knows how to convert a DatoCMS record into a canonical URL within the website.

// this function knows how to convert a DatoCMS record
// into a canonical URL within the website
const generatePreviewUrl = ({ item, itemType, locale }) => {
  switch (itemType.attributes.api_key) {
    case "landing_page":
      return `/landing-pages/${item.attributes.slug}`;
    case "blog_post":
      // blog posts are localized:
      const localePrefix = locale === "en" ? "" : `/${locale}`;
      return `${localePrefix}/blog/${item.attributes.slug[locale]}`;
    default:
      return null;
  }
};

export default eventHandler(async (event) => {
  // In this method, we'll make good use of the utility methods that
  // H3 make available: they all take the `event` as first parameter.
  // For more info, see: https://github.com/unjs/h3#utilities

  // Setup content-type and CORS permissions.
  setResponseHeaders(event, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type, Authorization", // add any other headers you need
  });

  // This will allow OPTIONS request
  if (event.req.method === "OPTIONS") {
    return send(event, "ok");
  }

  // Actually generate the URL using the info that DatoCMS is sending.
  const url = generatePreviewUrl(await readBody(event));

  // No URL? No problem: let's send back no link.
  if (!url) {
    return { previewLinks: [] };
  }

  // Let's guess the base URL using environment variables:
  // if you're not working with Vercel or Netlify,
  // ask for instructions to the provider you're deploying to.
  const baseUrl = process.env.VERCEL_BRANCH_URL
    ? // Vercel auto-populates this environment variable
      `https://${process.env.VERCEL_BRANCH_URL}`
    : // Netlify auto-populates this environment variable
      process.env.URL;

  // Here is the list of links we're returnig to DatoCMS and that
  // will be made available in the sidebar of the record editing page.
  const previewLinks = [
    // Public URL:
    {
      label: "Published version",
      url: `${baseUrl}${url}`,
    },
  ];

  return { previewLinks };
});
```

#### SvelteKit 2

Below here, you'll find a similar example, adapted for SvelteKit. For the purpose of this example, let's say we want to return a link to the webpage that contains the published content.

Create a `+server.ts` file under `src/routes/api/preview-links/` with following contents:

```js
import { json } from "@sveltejs/kit";

const generatePreviewUrl = ({ item, itemType, locale }: any) => {
  switch (itemType.attributes.api_key) {
    case "landing_page":
      return `/landing-pages/${item.attributes.slug}`;
    case "blog_post":
      // blog posts are localized:
      const localePrefix = locale === "en" ? "" : `/${locale}`;
      return `${localePrefix}/blog/${item.attributes.slug[locale]}`;
    case "post":
      return `posts/${item.attributes.slug}`;
    default:
      return null;
  }
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

export async function OPTIONS() {
  setHeaders(corsHeaders);

  return json("ok");
}

export async function POST({ request, setHeaders }) {
  setHeaders(corsHeaders);

  const data = await request.json();

  const url = generatePreviewUrl(data);

  if (!url) {
    return json({ previewLinks: [] });
  }

  const baseUrl = process.env.VERCEL_BRANCH_URL
    ? // Vercel auto-populates this environment variable
      `https://${process.env.VERCEL_BRANCH_URL}`
    : // Netlify auto-populates this environment variable
      process.env.URL;

  const previewLinks = [
    // Public URL:
    {
      label: "Published version",
      url: `${baseUrl}${url}`,
    },
  ];

  return json({ previewLinks });
}
```

#### Astro

Here's how to integrate with Astro - using server side rendering.

Create a `preview-links.ts` file under `pages/api` with following contents:

```js
export const prerender = false;
import type { APIRoute } from "astro";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: HEADERS,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  if (!body) {
    return new Response("No body found.", { status: 400 });
  }
  const { item } = body;
  if (!item) {
    return new Response("No item found.", { status: 400 });
  }
  const slug = item.attributes.slug;
  if (!slug) {
    return new Response("No slug found.", { status: 400 });
  }
  const siteUrl = new URL(request.url).origin;
  if (!siteUrl) {
    return new Response("No siteUrl found.", { status: 400 });
  }
  const previewLinks = [
    {
      label: "Live version",
      url: `${siteUrl}/${slug}`,
      reloadPreviewOnRecordUpdate: { delayInMs: 100 },
    },
    {
      label: "Draft version",
      url: `${siteUrl}/${slug}?draft=true`,
      reloadPreviewOnRecordUpdate: { delayInMs: 100 },
    },
  ];
  return new Response(
    JSON.stringify({
      previewLinks,
    }),
    {
      status: 200,
    }
  );
};
```

We're simply adding a `draft=true` query parameter to the URL to differentiate between the live and draft versions of the page.
Then in your page frontmatter, you can check for this query parameter and render the draft content by adding the `includeDrafts` header.

```js
---
export const prerender = false;
const query = graphql(
  `
    query HomeQuery {
      home {
        title
        content
      }
    }
  `
);

const graphQlOptions = {
  includeDrafts: false,
};

const doDrafts = Astro.url.searchParams.get("draft");
if (doDrafts) {
  graphQlOptions.includeDrafts = true;
}

const data = await executeQuery(query, graphQlOptions);
---
```
