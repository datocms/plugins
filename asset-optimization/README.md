# DatoCMS Asset Optimization Plugin

A plugin that allows you to mass apply optimizations to your DatoCMS assets, significantly reducing image file sizes while maintaining visual quality.

![Asset Optimization Plugin Cover](docs/cover-1200x800.png)

## Overview

The DatoCMS Asset Optimization Plugin leverages Imgix's powerful image processing capabilities to optimize your media library assets. It helps you:

- Reduce image file sizes without sacrificing quality
- Apply batch optimization to multiple assets
- Configure quality levels based on asset sizes
- Convert images to modern formats like AVIF or WebP
- Track optimization progress with detailed logs
- View statistics on storage savings
- Preview the impact of your settings before replacing anything

## Where it lives in DatoCMS

After installation, the plugin adds an **Asset Management → Optimize assets** entry in your environment's **Configuration** section. The plugin's configuration screen also provides a shortcut button to that page.

The plugin requires the `currentUserAccessToken` permission so it can replace assets on your behalf.

## Installation

1. Log in to your DatoCMS project
2. Go to Settings > Plugins
3. Search for "Asset Optimization"
4. Click "Install"

## Important: Use Sandbox Environments First

⚠️ **STRONGLY RECOMMENDED**: Always test this plugin in a sandbox environment before using it in production.

This plugin permanently replaces your original assets and they cannot be recovered. To ensure optimal results:

1. Create a sandbox environment in your DatoCMS project
2. Test the plugin with various optimization settings
3. Fine-tune thresholds and quality settings to your liking
4. Verify the optimized assets meet your quality standards
5. Once satisfied with the results, promote your changes to production

This approach allows you to safely experiment with different optimization parameters without risking your production assets.

## Usage

1. Open **Configuration →  Optimize assets**.
2. Configure the optimization settings according to your needs
   Optionally choose an **Asset collection** to process only that collection's matching images. Subcollections are excluded; **All assets** keeps the environment-wide behavior. Preview and replacement use the same scope, and discovery stops before replacements if the API returns an asset outside the selected collection.
3. Click **Preview Optimization** to dry-run the process and see expected savings without touching any assets
4. When you're happy with the projected results, click **Start Optimization**. You'll be asked to confirm twice before any asset is replaced
5. Watch the progress and the live activity log as the plugin processes your assets
6. Review the final statistics, including per-category lists of optimized, skipped, and failed assets

### Settings reference

The form groups settings into four sections:

- **Size Thresholds**
  - *Large Asset (MB)* and *Very Large Asset (MB)* — assets above each threshold get their own quality and resize profile
  - *Minimum Size Reduction (%)* — only replace an asset if Imgix can shrink it by at least this much

- **Basic Optimization**
  - *Preserve Original Format* — keep JPG/PNG/etc. instead of converting (`fm` parameter)
  - *Auto Compress* — let Imgix pick compression automatically (`auto=compress`)
  - *Target Format* (when not preserving) — `webp` or `avif`
  - *Resize Large Images* — toggle to limit max width via `max-w`

- **Resize Dimensions** (visible when resize is enabled)
  - *Large Image Max Width (px)* and *Very Large Image Max Width (px)*

- **Compression Settings**
  - *Large Image Quality* / *Very Large Image Quality* — `q` value 0–100 (hidden in lossless mode)

- **Advanced Options**
  - *Use Lossless Compression* (`lossless=1`)
  - *Use DPR Optimization* (`dpr=2` for Retina)
  - *Enhanced Chroma Sampling* (`chromasub=444` for JPEGs)
  - *Preserve Color Profiles* (`cs=origin`)

A *Restore Defaults* button is available at any time.

### Asset Filtering & Optimization

- **Size-Based Filtering**: Only process assets above a certain size threshold
- **Intelligent Optimization**: Apply different optimization strategies based on asset size categories
- **Format Conversion**: Convert images to modern formats like AVIF for better compression
- **Dimension Resizing**: Automatically resize oversized images while maintaining aspect ratio

### Website Performance Optimization

- Reduce page load times by decreasing image payload sizes
- Improve Core Web Vitals scores with optimized images
- Enhance mobile experience with appropriately sized images

### Storage Cost Reduction

- Minimize storage usage in your DatoCMS media library
- Reduce CDN bandwidth consumption
- Lower operating costs while maintaining quality

### Batch Processing

- Mass-update existing media libraries with optimized assets
- Apply consistent optimization settings across your entire asset collection
- Save time compared to manual optimization workflows
- Processing runs continuously with two workers (internally capped at three), automatic retries and live progress
- The downloaded Blob is reused for replacement without a second conversion/download; transient GET failures can retry automatically
- Asset lists show 100 entries per page; the activity log keeps the latest 300 entries

## Development

### Prerequisites

- Node.js 24+ (used for the deterministic validation suite)
- npm or yarn
- DatoCMS account with developer access

### Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Start the development server: `npm run dev`
4. Configure a local DatoCMS plugin in your project settings pointing to your local server

### Validation

```bash
npm run check
```

This runs Biome using the repository rules, TypeScript for source and tests, deterministic synthetic tests, and the production build. The root `run-checks.js` targets a fixed list of other plugins and does not include this package.

### Large libraries and replacement safety

The plugin discovers all matching images before starting replacements, using [CMA upload pages](https://www.datocms.com/docs/content-management-api/resources/upload/instances) of at most 500. This is necessary because replacing an image can remove it from the size filter and would shift offset pages during a run. Discovery retains only lightweight asset metadata; image binaries are loaded only by active workers. No records or model schemas are enumerated, regardless of record count, locales or nested blocks.

CMA requests share a 150 ms spacing and a rate-limit cooldown, leaving room below the documented [60 requests per three seconds](https://www.datocms.com/docs/content-management-api/technical-limits). CDN reads and signed binary uploads have bounded automatic retries and deadlines. An optimized image must be smaller than the original, achieve the configured reduction and fit the 32 MiB output limit. Oversized outputs are skipped without replacing the original. Unsupported, empty or obviously malformed responses fail individually; file extensions follow the detected image format.

Replacement updates only the existing upload's `path`, preserving its ID, references, metadata for every locale, tags and collection. It checks path, size, checksum and update timestamp before transfer and immediately before the write. It waits for the [asynchronous job](https://www.datocms.com/docs/content-management-api/async-jobs) and confirms the returned ID, path and size. Only an explicit rejected rate-limit response can retry an asset write. A lost response is reconciled by reading the asset, without sending another replacement. Unconfirmed writes appear as failures with an explanation. Converted images use a new URL, as documented for [upload replacement](https://www.datocms.com/docs/content-management-api/resources/upload/update); saved external URLs are not rewritten.

Cancel stops new work and pending downloads. Writes already sent are allowed to finish or be reconciled, and the summary retains confirmed successes, failures and the unprocessed count. Cancellation is optional; there is no mandatory pause or manual continuation workflow. Keep the plugin page open for the continuous run.

Synthetic tests cover 10,000 assets, full pagination before writes, bounded concurrency, cancellation, failures, multiple locales, streaming size limits, timeouts, retries and async-job reconciliation. They do not measure production throughput, real browser heap use, image quality, complete image decoding or CDN behavior. The 32 MiB cap limits each optimized output, not total browser heap use. Original files may be larger if their optimized output fits this cap.

The CMA does not document atomic version preconditions for upload replacement. An external edit between the final check and the write remains a race. Offset pagination is also not a transaction: concurrent external additions/deletions during discovery can change membership. Unknown job results can still complete later on the server. These limits are surfaced rather than hidden by blind retries.

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory, ready for deployment.

## Support

If you encounter any issues or have questions about the plugin, please [open an issue](https://github.com/marcelofinamorvieira/datocms-plugin-asset-optimization/issues) on GitHub.

## License

MIT
