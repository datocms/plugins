# Unsplash asset source

Search free high-resolution photos on Unsplash, and insert them directly inside of your DatoCMS project.

Once installed, the plugin registers Unsplash as an [asset source](https://www.datocms.com/docs/plugins/asset-sources). In the Media Area, the upload button becomes a dropdown with an Unsplash option.

## Features

- Browse trending photos out of the box, or run keyword searches.
- Filter searches by **orientation** (any, landscape, portrait, square) and by **color** (white, black, yellow, orange, red, purple, magenta, green, teal, blue, or black & white).
- Photos are imported at high resolution (up to 2500px wide, JPEG, q=80).
- The Unsplash author name is stored in the upload's "Author" field, and the photo description in the "Notes" field.
- For English locales, the photo's alt description is also pre-filled as the asset's `alt` text, and `unsplash_author_username` and `unsplash_photo_id` are stored in the asset's custom data so you can credit photographers programmatically on your site.

No Unsplash API key is required: requests are proxied through DatoCMS's own Unsplash API endpoint.
