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

## Large projects and failures

The plugin checks only the selected asset ID in each other environment. It does not download the project's assets, records, models, or locales. The [environment endpoint](https://www.datocms.com/docs/content-management-api/resources/environment/instances) returns the complete environment list without pagination.

Execution runs continuously with four workers and a shared request scheduler (at most four request starts per second). Automatic retries respect rate-limit response headers, with at most five attempts per request. HTTP requests and response-body reads have a 60-second timeout. An uncertain deletion is checked by ID before another DELETE is attempted; an inaccessible environment remains inconclusive. The CMA continues to enforce its [protection for assets used by records](https://www.datocms.com/docs/content-management-api/errors#UPLOAD_IS_CURRENTLY_IN_USE).

Partial failures remain visible alongside the remaining copies. A failed lookup never establishes that the current environment holds the last copy. Successful deletions and copies confirmed already absent are reported separately. The current environment is always excluded, and its final copy still requires manual deletion. The panel does not reload after deletion.

For more than ten environments, the panel displays completed/total progress. Lists larger than 100 environments render a small scrolling window. Switching the asset, environment, token, or permission scope stops queued work and aborts client HTTP requests. Aborting cannot undo a mutation already accepted by the server. Closing the panel ends the execution; there is no pause/resume workflow.

Results describe the environments checked at that time. Concurrent environment forks or other external changes may require a fresh check. API rate limits are shared with other project activity, so duration depends on server load, permissions, and retries. See the [current CMA limits](https://www.datocms.com/docs/content-management-api/technical-limits).

## Validation

Run `npm ci`, then `npm run check` from this plugin directory. The check combines lint, TypeScript, deterministic mocked tests, and a production build. Tests use one worker thread and a 60-second runner budget per test on shared development machines; API deadlines and backoff assertions use a virtual clock. The fixtures model 1,200 environments in a project with 10,000 assets and 200,000 records, without generating or querying those assets or records. They verify request scope, bounded concurrency, progress, failures, cancellation, retries, and uncertain deletion reconciliation. They do not prove production throughput or server-side reference handling.

## Version History
* 0.0.3: Moved plugin to official DatoCMS plugins repository. This was just an organizational change and does not add any features or fixes.
* 0.0.2: Clarified how it works
* 0.0.1: Initial alpha release. Basic working functionality, but limited permissions and error checking.
