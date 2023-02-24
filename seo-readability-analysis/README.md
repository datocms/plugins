# SEO/readability Analysis DatoCMS plugin

This plugin uses the [YoastSEO.js](https://github.com/Yoast/javascript/tree/master/packages/yoastseo) package to generate in real-time interesting SEO and readability metrics about a specific record you're editing in DatoCMS.

It shows potential SEO problems, improvements, considerations, and content that is already optimized or "Good".

🚨 **Important:** This is not a drag & drop plugin! It requires some work on your frontend website in order to function. Read more in the following sections!

## Installation and configuration

Once the plugin is installed, please configure your Frontend metadata endpoint URL in the plugin settings:

![Demo](https://raw.githubusercontent.com/datocms/plugins/master/seo-readability-analysis/docs/settings.png)

This plugin is meant to be used on JSON fields, so please assign it to some JSON fields in in your project.

The plugin will store information inside the JSON field using this structure:

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

### An example implementation for Next.js apps

Writing a Frontend Metadata endpoint on a Next.js website is extremely simple, if the website is already configured to fetch draft content from DatoCMS when [Preview Mode](https://nextjs.org/docs/advanced-features/preview-mode) is activated. To learn how to accomplish that, please read [the DatoCMS documentation](https://www.datocms.com/docs/next-js/setting-up-next-js-preview-mode), or take a look at this [example website](https://github.com/datocms/nextjs-demo/tree/master).

In Next.js such endpoint must be implemented as an [API Route](https://nextjs.org/docs/api-routes/introduction).

The following API Route uses the `res.setPreviewData` method to obtain the proper cookies for Preview Mode, which are immediately used to fetch the webpage related to the DatoCMS record. Once the complete HTML of the page is "scraped", it uses the `jsdom` package to pick the interesting parts of the page and build the proper response for the plugin:

```js
// Put this code in the following path of your Next.js website:
// /pages/api/get-frontend-metadata.js

import { SiteClient } from 'datocms-client';
import got from 'got';
import { JSDOM } from 'jsdom';

// this "routing" function knows how to convert a DatoCMS record
// into its slug and canonical URL within the website
const findSlugAndPermalink = async ({ item, itemTypeApiKey }) => {
  switch (itemTypeApiKey) {
    case 'blog_post':
      return [item.slug, `/blog/${item.slug}`];
    case 'landing_page':
      return [item.slug, `/cms/${item.slug}`];
    case 'changelog_entry':
      return [item.slug, `/product-updates/${item.slug}`];
    default:
      return [null, null];
  }
};

const handler = async (req, res) => {
  // setup relaxed CORS permissions
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // the following parameters are required and represent the
  // the record we want to get the preview for
  const missingParams = [
    'itemId',
    'itemTypeId',
    'itemTypeApiKey',
    'locale',
  ].filter((paramName) => !req.query[paramName]);

  if (missingParams.length > 0) {
    res.status(422).json({
      message: `Missing required parameters! ${missingParams.join(', ')}`,
    });
    return;
  }

  const { itemId, itemTypeId, itemTypeApiKey, sandboxEnvironmentId, locale } = req.query;

  // retrieve the complete record from the DatoCMS API
  const client = new SiteClient(process.env.DATOCMS_READONLY_TOKEN, { environment: sandboxEnvironmentId });
  const item = await client.items.find(itemId);

  // this "routing" function knows which record is linked to which URL
  // in the website
  const [slug, permalink] = await findSlugAndPermalink({
    item,
    itemTypeId,
    itemTypeApiKey,
    locale,
  });

  if (!permalink) {
    res.status(422).json({
      message: `Don\'t know which route corresponds to record #${itemId} (model: ${itemTypeApiKey})!`,
    });
    return;
  }

  // let's start a Next.js Preview Mode, and get the authentication cookies
  // (fill in the preview data object with whatever you need)
  res.setPreviewData({});

  const cookie = res
    .getHeader('Set-Cookie')
    .map((cookie) => cookie.split(';')[0])
    .join(';');

  res.clearPreviewData();

  // get the HTML of the page associated with the record (in Preview Mode)
  const { body } = await got(
    new URL(permalink, process.env.BASE_URL).toString(),
    {
      headers: { cookie },
    },
  );

  const { document } = new JSDOM(body).window;

  // here we're taking the content of the div with id="main-content"
  // as the page main-content, but this heavily depends on your layout!
  const contentEl = document.getElementById('main-content');

  if (!permalink) {
    res.status(422).json({
      message: `Cannot find div with ID=main-content in page #${permalink}!`,
    });
    return;
  }

  const pageContent = contentEl.innerHTML;

  // get the page locale by looking at the "lang" attribute on the <html> tag
  const pageLocale = document.querySelector('html').getAttribute('lang') || 'en';

  // get the <title> of the page
  const pageTitle = document.querySelector('title').textContent;

  // get the description meta of the page
  const pageDescription = document
    .querySelector('meta[name="description"]')
    .getAttribute('content');

  res.status(200).json({
    locale: pageLocale,
    slug,
    permalink,
    title: pageTitle,
    description: pageDescription,
    content: pageContent,
  });
};

export default handler;
```

If you have built alternative endpoint implementations for other frameworks/SSGs, please open up a PR to this plugin and share it with the community!
