# Delete Unused Asset From Other Environments

This plugin will look for extra, UNUSED copies of an asset across your other environments and allow you to easily delete them.

You should only use this if you need to clear an asset from our CDN altogether (datocms-assets.com).

After you delete the extra copies from your other environments, you also need to manually delete the final copy in the current environment. This last image cannot self-destruct, and must be manually deleted by you.

Then, once all copies are destroyed, the asset should disappear from the CDN within 24 hours.

## How it works
This plugin looks for the same asset ID and in your other sandbox environments and will attempt to delete them.

It is ONLY meant for finding extra copies of the exact same image ID across your sandbox environments, for the sole purpose of deleting all of them so the asset can be evicted from our CDN cache.

It does NOT:
* Help you save disk space (our system already de-duplicates assets across your environments)
* Do any sort of visual similarity checking or perceptual hashing to find similar images. It ONLY checks the image ID
* Delete in-use assets (assets that are used in a record)

## Permissions

Please make sure you have sufficient permissions for managing images across all your environments, and access to the environments themselves.

## Version History
* 0.0.2: Clarified how it works
* 0.0.1: Initial alpha release. Basic working functionality, but limited permissions and error checking.