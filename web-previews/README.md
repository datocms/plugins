# Web Previews DatoCMS plugin

This plugin adds quick links in the record sidebar to preview your webpages.

🚨 **Important:** This is not a drag & drop plugin! It requires some work on your frontend website(s) in order to function. Read more in the following sections!

## Installation and configuration

Once the plugin is installed you need to specify:

- A list of frontends. Each frontend specifies a name and a preview webhook, which will be called as soon as the plugin is loaded. Read more about it on the next chapter.
- Sidebar open: to specify whether you want the sidebar panel to be opened by default.

## The Previews webhook

Each frontend must implement a CORS-ready JSON endpoint that, given a specific DatoCMS record, returns an array of preview link(s).

The plugin performs a POST request to the Previews webhook URL, passing a payload that includes the current environment, record and model:

```json
{
  "item": {…},
  "itemType": {…},
  "environmentId": "main",
  "locale": "en",
}
```

- `item`: [CMA entity](https://www.datocms.com/docs/content-management-api/resources/item) of the current record
- `itemType`: [CMA entity](https://www.datocms.com/docs/content-management-api/resources/item-type) of the model of the current record
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

The plugin will display all the returned preview links.

### An example implementation for Next.js apps

For the purpose of this example, let's say we want to return two preview links, one that links to the webpage that contains the published content, and another with draft content using [Next.js Preview Mode](https://www.datocms.com/docs/next-js/setting-up-next-js-preview-mode).

DatoCMS will make a POST request the webhook with the info about the current record. We need to implement a CORS enabled API endpoint that handles the information and returns an array of preview links:

```js
// Put this code in the following path of your Next.js website:
// /pages/api/preview/links.js

// this "routing" function knows how to convert a DatoCMS record
// into canonical URL within the website
const generatePreviewLink = ({ item, itemType, locale }) => {
  const localePrefix = locale === "en" ? "" : `/${locale}`;

  switch (itemType.attributes.api_key) {
    case "landing_page":
      return {
        label: `${item.title}`,
        url: `/landing-pages/${item.attributes.slug}`,
      };
    case "blog_post":
      // blog posts are localized, let's use the locale to show relevant information:
      return {
        label: `${item.title[locale]}`,
        url: `${localePrefix}/blog/${item.attributes.slug[locale]}`,
      };
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

  const previewLink = generatePreviewLink(req.body);

  if (!previewLink) {
    return res.status(200).json({ previewLinks: [] });
  }

  const previewLinks = [
    previewLink,
    // we generate the Preview Mode URL:
    {
      label: `${previewLink.label} - Preview`,
      url: `https://mysite.com/api/preview/start?redirect=${previewLink.url}`,
    },
  ];

  return res.status(200).json({ previewLinks });
};

export default handler;
```

If you have built alternative endpoint implementations for other frameworks/SSGs, please open up a PR to this plugin and share it with the community!
