# SEO/readability Analysis DatoCMS plugin

This plugin uses the [YoastSEO.js](https://github.com/Yoast/javascript/tree/master/packages/yoastseo) package to generate in real-time interesting SEO and readability metrics about a specific record you're editing in DatoCMS.

It shows potential SEO problems, improvements, considerations, and content that is already optimized or "Good".

🚨 **Important:** This is not a drag & drop plugin! It requires some work on your frontend website in order to function. Read more in the following sections!

## Installation and configuration

Once the plugin is installed, please configure your Frontend metadata endpoint URL in the plugin settings:

![Demo](https://raw.githubusercontent.com/datocms/plugins/master/seo-readability-analysis/docs/settings.png)

This plugin is meant to be used on JSON fields, so please assign it to some JSON fields in in your project.

### Storage format

The plugin adapts its storage format based on whether your DatoCMS project uses multiple locales.

**For projects with multiple locales**, the plugin will store information inside the JSON field using this structure:

```json
{
  "en": {
    "keyword": "food shows",
    "synonyms": "cooking shows, culinary demonstrations",
    "relatedKeywords": [
      {
        "keyword": "food",
        "synonyms": ""
      }
    ]
  },
  "it": {
    "keyword": "programmi di cucina",
    "synonyms": "spettacoli di cucina",
    "relatedKeywords": []
  }
}
```

This allows you to set different SEO keywords for each locale in your project.

**For projects with a single locale**, the plugin will store information inside the JSON field using this structure:

```json
{
  "keyword": "food shows",
  "synonyms": "cooking shows, culinary demonstrations",
  "relatedKeywords": [
    {
      "keyword": "food",
      "synonyms": ""
    }
  ]
}
```

## The Frontend metadata endpoint

In order to work, this plugin needs a CORS-ready endpoint API that is able to return, given the ID of a DatoCMS record, a number of information related to its canonical page (that is, the page on the frontend that presents the content stored inside the record).

The plugin performs a GET request to the URL specified in the settings, passing down the following query string parameters:

```
<ENDPOINT_URL>?itemId=89274&itemTypeId=544589&itemTypeApiKey=blog_post&environmentId=main&locale=en
```

- `itemId` the ID of the DatoCMS record
- `itemTypeId` the ID of the record's model
- `itemTypeApiKey` the API key of the record's model
- `sandboxEnvironmentId` the environment ID (only passed if the record belongs to a sandbox environment)
- `locale` the preferred locale

The endpoint is expected to return a 200 response, with the following JSON structure:

```json
{
  "locale": "en",
  "slug": "hello-world",
  "permalink": "https://www.yourwebsite.com/blog/hello-world",
  "title": "This is the SEO title of the page",
  "description": "This is the SEO description of the page",
  "content": "<p>This is the main content of the page/article</p>..."
}
```

To better serve the content writer, the information returned should be related to the latest version of the record's content — which could be unpublished.

### Implementation examples

If you have built alternative endpoint implementations for other frameworks, please open up a PR to this plugin and share it with the community!

#### Next.js

We suggest you look at the code of our [official Next.js Starter Kit](https://github.com/datocms/nextjs-starter-kit):

* Route handler called implementing the endpoint: [`src/app/api/seo-analysis/route.tsx`](https://github.com/datocms/nextjs-starter-kit/blob/main/src/app/api/seo-analysis/route.tsx)
* Route handlers to toggle Next.js [Draft Mode](https://www.datocms.com/docs/next-js/setting-up-next-js-draft-mode): [`app/api/draft-mode/enable/route.tsx`](https://github.com/datocms/nextjs-starter-kit/blob/main/src/app/api/draft-mode/enable/route.tsx) and [`app/api/draft-mode/disable/route.tsx`](https://github.com/datocms/nextjs-starter-kit/blob/main/src/app/api/draft-mode/disable/route.tsx)
