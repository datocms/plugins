# Web Previews DatoCMS plugin

This plugin adds quick links in the record sidebar to preview your webpages.

🚨 **Important:** This is not a drag & drop plugin! It requires some work on your frontend website in order to function. Read more in the following sections!

## Installation and configuration

Once the plugin is installed you need to specify :

- A Web Preview Webhook: this hook will be called as soon as the plugin is loaded. Read more about it on the next chapter.
- The frontends URLs and names you want to show in the web previews plugin.
- The last setting is to determine whether you want the web preview sidebar panel to be opened by default.

## The preview webhook

In order to work, this plugin needs a CORS-ready endpoint API that is able to return, given the payload of a DatoCMS record, the preview links you want to show.

The plugin performs a POST request to the URL specified in the settings, passing down the following payload:

```json
{
  "item": {…},
  "itemType": {…},
  "sandboxEnvironmentId": "primary",
  "locale": "en",
  "frontends": [
    {
      "previewUrl": "https://mysite.com",
      "name": "Production"
    },
    {
      "previewUrl": "https://staging.mysite.com",
      "name": "Staging"
    },
  ]
}
```

- `item` all the info on the record
- `itemType` all the info on the model
- `sandboxEnvironmentId` the environment ID
- `locale` the selected locale
- `frontends` the URLs specified in the plugin settins

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

The plugin will display as many buttons as the specified URLs

### An example implementation for Next.js apps

For the purpose of this example, let's say we want to create two buttons, one that links to a webpage that contains published content, and another with draft content.

#### Next.js preview mode

To do that you need to have a preview endpoint on a Next.js app configured to fetch draft content from DatoCMS when [Preview Mode](https://nextjs.org/docs/advanced-features/preview-mode) is activated. To learn how to do that that, please read [the DatoCMS documentation](https://www.datocms.com/docs/next-js/setting-up-next-js-preview-mode), or take a look at this [example website](https://github.com/datocms/nextjs-demo/tree/master).

Next step is to implement such endpoint as an [API Route](https://nextjs.org/docs/api-routes/introduction).

This API Route uses the `response.setPreviewData` method to obtain the proper cookies for Preview Mode, which are immediately used to fetch the webpage related to the DatoCMS record.

#### The web previews webhook

Now we need to build our webhook that should be able to generate a preview link from the info on the record. In this case let's say that we have a slug field that identifies the record.

Our webhook will generate a draft and published link from each frontend we specified in the settings

```js
// Put this code in the following path of your Next.js website:
// /pages/api/preview/links.js

// this "routing" function knows how to convert a DatoCMS record
// into its slug and canonical URL within the website
const findPermalink = async ({ item, itemType, locale }) => {
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

const handler = async (req, res) => {
  // setup CORS permissions
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json");

  // This will allow OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).send("ok");
  }

  const { item, itemType, sandboxEnvironmentId, locale, frontends } = req.body;

  // this "routing" function knows which record is linked to which URL
  // in the website
  const permalink = await findPermalink({
    item,
    itemType,
    locale,
  });

  if (!permalink) {
    res.status(200).json({ urls: [] });
    return;
  }

  let urls = [];

  frontends.forEach(
    ({ previewUrl, name }) =>
      (urls = [
        ...urls,
        {
          label: `${name} (${locale})`,
          url: `${previewUrl}/${permalink}`,
        },
        {
          label: `Draft ${name} (${locale})`,
          url: `${previewUrl}/api/preview/start?slug=${permalink}`,
        },
      ])
  );

  res.status(200).json({ urls });
};

export default handler;
```

If you have built alternative endpoint implementations for other frameworks/SSGs, please open up a PR to this plugin and share it with the community!
