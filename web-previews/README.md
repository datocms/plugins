# Web Previews DatoCMS plugin

This plugin adds quick links in the record sidebar to preview your webpages.

🚨 **Important:** This is not a drag & drop plugin! It requires some work on your frontend website in order to function. Read more in the following sections!

## Installation and configuration

Once the plugin is installed you need to specify :

- Frontends
  - name: the name that identifies the frontend.
  - preview webhook: this hook will be called as soon as the plugin is loaded. Read more about it on the next chapter.

Optional settings

- Sidebar Open: to specify whether you want the web preview sidebar panel to be opened by default.

## The Previews Webhook

In order to work, this plugin needs a CORS-ready endpoint API that is able to return, given the payload of a DatoCMS record, the preview links you want to show.

Every time it is loaded into the page, the plugin performs a POST request to the Previews Webhook URL, passing a payload that includes the info on the record and model and the frontends that you specified in the global settings:

```json
{
  "item": {…},
  "itemType": {…},
  "sandboxEnvironmentId": "main",
  "locale": "en",
  "name": "Production"
}
```

- `item` all the info on the record
- `itemType` all the info on the model
- `sandboxEnvironmentId` the environment ID
- `locale` the current locale
- `name` the name you associated to the frontend in the global settings

The endpoint is expected to return a 200 response, with the following JSON structure:

```json
{
  "urls": [
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

The plugin will display as many preview links as the specified urls.

### An example implementation for Next.js apps

For the purpose of this example, let's say we want to create two preview links, one that links to a webpage that contains published content, and another with draft content.

#### Next.js preview mode

To do that you need to have a preview endpoint on a Next.js app configured to fetch draft content from DatoCMS when [Preview Mode](https://nextjs.org/docs/advanced-features/preview-mode) is activated. To learn how to do that that, please read [the DatoCMS documentation](https://www.datocms.com/docs/next-js/setting-up-next-js-preview-mode), or take a look at this [example website](https://github.com/datocms/nextjs-demo/tree/master).

Next step is to implement such endpoint as an [API Route](https://nextjs.org/docs/api-routes/introduction).

This API Route uses the `response.setPreviewData` method to obtain the proper cookies for Preview Mode, which are immediately used to fetch the webpage related to the DatoCMS record.

#### The web previews webhook

Now we need to build our webhook, that should be able to generate both a preview link to the published content and a preview to the draft content, using Next preview mode. In this case let's say that we have a slug field that identifies the record.

DatoCMS will make a POST request to each frontend webhook we specified in the settings, with the info on the current record. We need to imlement a CORS enabled webhook that handles the information and returns an array of preview URLs.

```js
// Put this code in the following path of your Next.js website:
// /pages/api/preview/links.js

// this "routing" function knows how to convert a DatoCMS record
// into its slug and canonical URL within the website
const findPermalink = ({ item, itemType, locale }) => {
  const localePrefix = locale === "en" ? "" : `/${locale}`;

  switch (itemType.attributes.api_key) {
    case "blog_post":
      return `${localePrefix}/blog/${item.slug}`;
    case "landing_page":
      return `${localePrefix}/landing-pages/${item.slug}`;
    case "updates":
      return `${localePrefix}/product-updates/${item.slug}`;
    default:
      return null;
  }
};

const handler = (req, res) => {
  // setup CORS permissions
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json");

  // This will allow OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).send("ok");
  }

  const { item, itemType, sandboxEnvironmentId, locale, name } = req.body;

  const permalink = findPermalink({
    item,
    itemType,
    locale,
  });

  if (!permalink) {
    return res.status(200).json({ urls: [] });
  }

  const urls = [
    {
      label: `${name} (${locale})`,
      url: `https://mysite.com/${permalink}`,
    },
    {
      label: `Draft ${name} (${locale})`,
      url: `https://mysite.com/api/preview/start?slug=${permalink}`,
    },
  ];

  return res.status(200).json({ urls });
};

export default handler;
```

If you have built alternative endpoint implementations for other frameworks/SSGs, please open up a PR to this plugin and share it with the community!
