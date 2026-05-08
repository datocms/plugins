# Slug Redirects

A plugin that registers all slug changes conveniently to manage redirects.

## How it works

When the plugin is first installed it bootstraps a singleton model called **🐌 Slug Redirects** (API key `slug_redirect`) with a JSON field called `redirects` (initially set to an empty array). All the redirect rules collected by the plugin are appended to this JSON array on that singleton record, so you can read it from your frontend to set up your redirects.

Add the plugin to the slug fields you want as a field addon. From then on, all of the changes made to those slug fields will be logged and saved with a "source" and "destination" rule on the **🐌 Slug Redirects** singleton record.

Each entry pushed to the JSON array has this shape:

```json
{
  "source": "old-slug",
  "destination": "new-slug",
  "urlPrefix": "",
  "recordID": "12345"
}
```

## Configuration

The plugin's configuration screen exposes a single toggle:

- **Add redirect rule only upon record publication** — when off (default), the plugin records redirects on every record save. When on, it ignores ordinary saves and only records a redirect when the record is published (useful for models with the Draft/Publish workflow so that you don't pollute the redirects list with intermediate slug changes).

## Changelog

- 0.7.6 - Fixed the plugin failing to load from `plugins-cdn.datocms.com` ("not responding correctly after 20 seconds"). The Vite build was emitting absolute asset paths that 404'd from the per-plugin subdirectory; now configured with `base: './'` so the bundled `index.html` references its assets relatively. Also tightened a few `as object` casts in the upsert/publish hooks so the project type-checks again.
