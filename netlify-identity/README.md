# Netlify Identity DatoCMS plugin

A plugin that nicely displays Netlify identity user info instead of the raw ID. Still work in progress!

## Configuration

[Describe/screenshot any global/instance parameters this plugin requires]

## Development

Install all the project dependencies with:

```
yarn install
```

Start the local development server with:

```
yarn start
```

The plugin will be served from [https://datocms-plugin-netlify-identity.localtunnel.me/](https://datocms-plugin-netlify-identity.localtunnel.me/). Insert this URL as the plugin [Entry point URL](https://www.datocms.com/docs/plugins/creating-a-new-plugin/).

## Publishing

Before publishing this plugin, make sure:

* you've properly described any configuration parameters in this README file;
* you've properly compiled this project's `package.json` following the [official rules](https://www.datocms.com/docs/plugins/publishing/);
* you've added a cover image (`cover.png`) and a preview GIF (`preview.gif`) into the `docs` folder.

When everything's ready, just run:

```
yarn publish
```
