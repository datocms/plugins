# Delete Assets Option

When you delete records, asks whether to also delete the assets that are only used in those records.

## Usage

Install the plugin and allow it to use the current user's API token. Then delete records as usual. Before they're deleted, the plugin asks "Delete assets only used in these records?" Choose **Keep** to delete only the records, or **Delete** to clean up their assets too.

The plugin looks at the current and published versions of the selected records, in every locale, including SEO images and assets inside blocks. Once the records are gone, it deletes those assets and tells you how many were deleted and how many were kept.

DatoCMS refuses to delete an asset that is still used by another record or by an environment setting, so shared assets are kept, even when you can't see the record that uses them. If anything goes wrong before the records are deleted, the plugin keeps all the assets.

## Limitations

Only assets placed in asset fields, SEO fields and blocks count. Asset URLs pasted into text or JSON fields are ignored.

The plugin doesn't change the dashboard's bulk deletion limit of 200 records.

Asset cleanup runs in the browser after the records are deleted. Reloading the page, logging out or switching environments before it finishes can interrupt it.

## Development

```sh
npm ci
npm run dev
npm run check
```
