# Netlify Identity DatoCMS plugin

A plugin that nicely displays Netlify Identity user info instead of the raw ID.

## Configuration

To fetch user info for your Netlify Identity instance, you need to publish a specific Netlify function.

Install the `datocms-plugin-netlify-identity` package in your project, then add a file called `user-info.js` in your [functions folder](https://www.netlify.com/docs/functions/#configuring-the-functions-folder) with the following content:

```
const generateHandler = require('datocms-plugin-netlify-identity');

const accessToken = 'CHANGEME';

exports.handler = generateHandler(accessToken);
```

Once deployed, you can configure the plugin setting inserting both the URL of the Netlify function, and the access token you chose:

![Demo](https://raw.githubusercontent.com/datocms/plugins/master/netlify-identity/docs/settings.png)

## Development

Install all the project dependencies with:

```
npm install
```

Start the local development server with:

```
npm start
```

The plugin will be served from [https://datocms-plugin-netlify-identity.localtunnel.me/](https://datocms-plugin-netlify-identity.localtunnel.me/). Insert this URL as the plugin [Entry point URL](https://www.datocms.com/docs/plugins/creating-a-new-plugin/).
