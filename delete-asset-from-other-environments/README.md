# Delete Unused Asset From Other Environments

Finds unused copies of an asset in your other environments and deletes them, so the asset can be removed from the CDN (datocms-assets.com) altogether. Only use it for that.

## Usage

Make sure your role can manage assets in every environment and has access to the environments themselves.

Open an asset in the media library and open the **Delete from other environments** panel in its sidebar. The plugin looks for an asset with the same ID in each of your other environments, lists the ones that have it, and offers to delete those copies.

The copy in the current environment is never deleted by the plugin. Once the other copies are gone, delete it yourself with the regular **Delete** link at the top of the sidebar. When every copy is deleted, the asset should disappear from the CDN within 24 hours.

If some environments can't be checked, the panel says so and lets you retry, since other copies may still exist. Keep the panel open until it finishes.

## What it doesn't do

It only matches the exact asset ID. It doesn't look for visually similar images, and it won't save you storage, because DatoCMS already de-duplicates assets across environments.

It can't delete a copy that a record in that environment still uses.

## Development

```sh
npm ci
npm run dev
npm run check
```
