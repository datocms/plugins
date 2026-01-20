# Media Layouts

A DatoCMS plugin that extends JSON fields to allow editors to select assets with precise layout configuration including aspect ratios and output widths. Ideal for content that requires specific rendering dimensions across responsive breakpoints.

![DatoCMS Plugin](https://img.shields.io/badge/DatoCMS-Plugin-ff7751)

## Features

- **Self-contained data**: Stores URL, filename, and all metadata directly in JSON—no additional API calls needed
- **Three operational modes**: Single asset, multiple assets (gallery), or predefined layout slots
- **Aspect ratio control**: 9 presets plus custom ratios for precise cropping
- **Width presets**: From 320px mobile to 4K resolution
- **Focal point support**: Preserves focal point data from DatoCMS media library
- **Metadata editing**: Edit alt text, title, and focal point directly from the field
- **Layout mode**: Define grid-based slot configurations with required fields
- **Automatic height calculation**: Heights computed from width and aspect ratio for easy imgix integration

## Installation

1. Go to **Settings > Plugins** in your DatoCMS project
2. Click **Add new plugin**
3. Search for "Media Layouts" or install from URL:
   ```
   https://github.com/datocms/plugins/media-layouts
   ```

## Configuration

### Global Settings

Configure default values that apply to all fields using this plugin:

| Setting | Description | Default |
|---------|-------------|---------|
| Default Aspect Ratio | Applied to new assets when no field override exists | 16:9 |
| Default Width | Applied to new assets when no field override exists | 1920px |

### Field Configuration

When adding the plugin to a JSON field, you must select a mode:

#### Single Asset Mode

Select one image with layout controls. Stores a single `MediaLayoutItem` object.

#### Multiple Assets Mode (Gallery)

Select multiple images, each with independent layout settings. Stores an array of `MediaLayoutItem` objects.

#### Layout Mode (Predefined Slots)

Define a grid with named slots that editors fill with assets. Each slot has:
- **Label**: Descriptive name (e.g., "Hero Image", "Sidebar Thumbnail")
- **Aspect Ratio**: Fixed ratio for this slot
- **Width**: Fixed output width for this slot
- **Required**: Whether the slot must be filled

Grid supports 1-4 columns and 1-6 rows.

### Field Overrides

For single/multiple modes, you can optionally override global defaults:
- Toggle "Override default aspect ratio" to set a field-specific ratio
- Toggle "Override default width" to set a field-specific width

## Aspect Ratio Options

| Value | Label | Use Case |
|-------|-------|----------|
| `original` | Original (no crop) | Preserve native dimensions |
| `16:9` | Widescreen | Video players, hero banners |
| `4:3` | Standard | Traditional TV format |
| `1:1` | Square | Social media, avatars |
| `3:2` | Photo | Standard photography |
| `2:3` | Portrait Photo | Vertical photography |
| `21:9` | Ultrawide | Cinematic banners |
| `9:16` | Portrait/Mobile | Stories, vertical video |
| `3:4` | Portrait Standard | Vertical content |
| `custom` | Custom... | Enter any ratio (e.g., `2.35:1`) |

## Width Presets

| Width | Label | Typical Use |
|-------|-------|-------------|
| 320px | Mobile small | Feature phones |
| 640px | Mobile | Standard mobile |
| 768px | Tablet | Portrait tablets |
| 1024px | Tablet landscape | Landscape tablets |
| 1280px | Desktop small | Small laptops |
| 1920px | Full HD | Standard desktop |
| 2560px | 2K | High-resolution displays |
| 3840px | 4K | Ultra HD displays |

## Data Model

The plugin stores all asset data directly in the JSON field, including the URL. No additional API calls are needed to render images.

### Single Mode

```json
{
  "uploadId": "abc123",
  "url": "https://www.datocms-assets.com/12345/image.jpg",
  "filename": "image.jpg",
  "format": "jpg",
  "size": 245000,
  "alt": "A beautiful sunset",
  "title": "Sunset at the beach",
  "focalPoint": { "x": 0.5, "y": 0.3 },
  "aspectRatio": "16:9",
  "width": 1920,
  "height": 1080,
  "originalWidth": 4000,
  "originalHeight": 3000
}
```

### Multiple Mode

```json
[
  {
    "uploadId": "abc123",
    "url": "https://www.datocms-assets.com/12345/photo1.jpg",
    "filename": "photo1.jpg",
    "format": "jpg",
    "size": 180000,
    "alt": "First image",
    "title": null,
    "focalPoint": null,
    "aspectRatio": "1:1",
    "width": 640,
    "height": 640,
    "originalWidth": 2000,
    "originalHeight": 2000
  },
  {
    "uploadId": "def456",
    "url": "https://www.datocms-assets.com/12345/photo2.png",
    "filename": "photo2.png",
    "format": "png",
    "size": 320000,
    "alt": "Second image",
    "title": null,
    "focalPoint": { "x": 0.3, "y": 0.5 },
    "aspectRatio": "4:3",
    "width": 1024,
    "height": 768,
    "originalWidth": 3000,
    "originalHeight": 2000
  }
]
```

### Layout Mode

```json
[
  {
    "slotId": "hero",
    "uploadId": "abc123",
    "url": "https://www.datocms-assets.com/12345/hero.jpg",
    "filename": "hero.jpg",
    "format": "jpg",
    "size": 450000,
    "alt": "Hero banner",
    "title": null,
    "focalPoint": { "x": 0.5, "y": 0.5 },
    "aspectRatio": "21:9",
    "width": 1920,
    "height": 823,
    "originalWidth": 4000,
    "originalHeight": 2000
  },
  {
    "slotId": "sidebar",
    "uploadId": "def456",
    "url": "https://www.datocms-assets.com/12345/sidebar.jpg",
    "filename": "sidebar.jpg",
    "format": "jpg",
    "size": 85000,
    "alt": "Sidebar image",
    "title": null,
    "focalPoint": null,
    "aspectRatio": "1:1",
    "width": 320,
    "height": 320,
    "originalWidth": 800,
    "originalHeight": 800
  }
]
```

### TypeScript Types

```typescript
type MediaLayoutItem = {
  uploadId: string;
  url: string;
  filename: string;
  format: string | null;
  size: number;
  alt: string | null;
  title: string | null;
  focalPoint: { x: number; y: number } | null;
  aspectRatio: string;
  customAspectRatio?: string; // When aspectRatio is "custom"
  width: number;
  height: number;
  originalWidth: number | null;
  originalHeight: number | null;
};

// Single mode value
type SingleFieldValue = MediaLayoutItem | null;

// Multiple mode value
type MultipleFieldValue = MediaLayoutItem[];

// Layout mode value
type SlotAssignment = MediaLayoutItem & { slotId: string };
type LayoutFieldValue = SlotAssignment[];
```

## Usage with imgix

The stored URL, width, height, and focal point data integrates directly with DatoCMS imgix:

```javascript
const { url, width, height, focalPoint, aspectRatio } = mediaLayoutItem;

// Build imgix parameters
const params = new URLSearchParams({
  w: width.toString(),
  h: height.toString(),
  fit: aspectRatio === 'original' ? 'max' : 'crop',
});

// Add focal point if available
if (focalPoint && aspectRatio !== 'original') {
  params.set('crop', 'focalpoint');
  params.set('fp-x', focalPoint.x.toString());
  params.set('fp-y', focalPoint.y.toString());
}

const finalUrl = `${url}?${params.toString()}`;
```

## Fetching Data

JSON fields return the complete JSON blob in GraphQL queries. Since the URL is stored directly, no additional API calls are needed:

```graphql
query {
  blogPost {
    heroImage # Returns the full MediaLayoutItem or array with URL included
  }
}
```

The response contains everything needed to render images, including the base URL which you can combine with imgix parameters.

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Type check
npx tsc -b
```

## License

MIT
