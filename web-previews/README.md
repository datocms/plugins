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
  "siteId": "123",
  "environmentId": "main",
  "locale": "en",
}
```

- `item`: [CMA entity](https://www.datocms.com/docs/content-management-api/resources/item) of the current record
- `itemType`: [CMA entity](https://www.datocms.com/docs/content-management-api/resources/item-type) of the model of the current record
- `currentUser`: CMA entity of the [collaborator](https://www.datocms.com/docs/content-management-api/resources/user), [SSO user](https://www.datocms.com/docs/content-management-api/resources/sso-user) or [account owner](https://www.datocms.com/docs/content-management-api/resources/account) currently logged in
- `siteId`: the ID of the current DatoCMS project
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

## Implementation examples

If you have built alternative endpoint implementations for other frameworks/SSGs, please open up a PR to this plugin and share it with the community!

### Next.js

We suggest you look at the code of our [official Starter Kit](https://github.com/datocms/nextjs-starter-kit):

* Route handler for the Previews webhook: [`app/api/preview-links/route.tsx`](https://github.com/datocms/nextjs-starter-kit/blob/main/src/app/api/preview-links/route.tsx)
* Route handlers to toggle Next.js [Draft Mode](https://www.datocms.com/docs/next-js/setting-up-next-js-draft-mode): [`app/api/draft-mode/enable/route.tsx`](https://github.com/datocms/nextjs-starter-kit/blob/main/src/app/api/draft-mode/enable/route.tsx) and [`app/api/draft-mode/disable/route.tsx`](https://github.com/datocms/nextjs-starter-kit/blob/main/src/app/api/draft-mode/disable/route.tsx)

The preview link URLs also include a `token` query parameter that the plugin would send to the webhook receiver, like `https://www.mywebsite.com/api/preview-links?token=some-secret-ish-string`. The `token` is a string of your choice that just has to match in both the plugin settings and [in your frontend's environment variables](https://github.com/datocms/nextjs-starter-kit/blob/main/src/app/api/preview-links/route.tsx#L31-L34). While not encryption, this token is an easy way to limit access to your preview content.

### Nuxt

We suggest you look at the code of our [official Starter Kit](https://github.com/datocms/nuxt-starter-kit):

* Route handler called for the Previews webhook [server/api/preview-links/index.ts](https://github.com/datocms/nuxt-starter-kit/blob/main/server/api/preview-links/index.ts)
* Route handlers to toggle draft mode: [`server/api/draft-mode/enable.ts`](https://github.com/datocms/nuxt-starter-kit/blob/main/server/api/draft-mode/enable.ts) and [`server/api/draft-mode/disable.ts`](https://github.com/datocms/nuxt-starter-kit/blob/main/server/api/draft-mode/disable.ts)

The preview link URLs also include a `token` query parameter that the plugin would send to the webhook receiver, like `https://www.mywebsite.com/api/preview-links?token=some-secret-ish-string`. The `token` is a string of your choice that just has to match in both the plugin settings and [in your frontend's environment variables](https://github.com/datocms/nuxt-starter-kit/blob/main/server/api/preview-links/index.ts#L42-L44). While not encryption, this token is an easy way to limit access to your preview content.

### SvelteKit

We suggest you look at the code of our [official Starter Kit](https://github.com/datocms/sveltekit-starter-kit):

* Route handler for the Previews webhook: [`src/routes/api/preview-links/+server.ts`](https://github.com/datocms/sveltekit-starter-kit/blob/main/src/routes/api/preview-links/%2Bserver.ts)
* Route handlers to toggle draft mode: [`routes/api/draft-mode/enable/+server.ts`](https://github.com/datocms/sveltekit-starter-kit/blob/main/src/routes/api/draft-mode/enable/%2Bserver.ts) and [`routes/api/draft-mode/disable/+server.ts`](https://github.com/datocms/sveltekit-starter-kit/blob/main/src/routes/api/draft-mode/disable/%2Bserver.ts)

The preview link URLs also include a `token` query parameter that the plugin would send to the webhook receiver, like `https://www.mywebsite.com/api/preview-links?token=some-secret-ish-string`. The `token` is a string of your choice that just has to match in both the plugin settings and [in your frontend's environment variables](https://github.com/datocms/sveltekit-starter-kit/blob/main/src/routes/api/preview-links/%2Bserver.ts#L34-L36). While not encryption, this token is an easy way to limit access to your preview content.

### Astro

We suggest you look at the code of our [official Starter Kit](https://github.com/datocms/astro-starter-kit):

* Route handler for the Previews webhook: [`src/pages/api/preview-links/index.ts`](https://github.com/datocms/astro-starter-kit/blob/main/src/pages/api/preview-links/index.ts)
* Route handlers to toggle draft mode: [`src/pages/api/draft-mode/enable/index.ts`](https://github.com/datocms/astro-starter-kit/blob/main/src/pages/api/draft-mode/enable/index.ts) and [`src/pages/api/draft-mode/disable/index.ts`](https://github.com/datocms/astro-starter-kit/blob/main/src/pages/api/draft-mode/disable/index.ts)

The preview link URLs also include a `token` query parameter that the plugin would send to the webhook receiver, like `https://www.mywebsite.com/api/preview-links?token=some-secret-ish-string`. The `token` is a string of your choice that just has to match in both the plugin settings and [in your frontend's environment variables](https://github.com/datocms/astro-starter-kit/blob/main/src/pages/api/preview-links/index.ts#L33-L35). While not encryption, this token is an easy way to limit access to your preview content.






