# Character Counter

A DatoCMS plugin that automatically adds a compact text analytics addon to fields configured with length validation.
It also adds live title and description counters to SEO fields.

By default, the addon stays quiet and shows a one-line summary with the most important metrics. Editors can expand it when they want more detail.

## Credit

This plugin interface is heavily inspired by [datocms-plugin-word-counter](https://github.com/voorhoede/datocms-plugin-word-counter). Credit to the original work by Voorhoede for the inspiration.

## What it shows

### In the collapsed summary

- Characters
- Words
- Special characters
- Sentences
- Paragraphs

### Inside “Show details”

- Include spaces toggle for the character count
- Filter stopwords toggle for supported English locales (`en*`)
- Common words list with live frequencies

## Field behavior

- `slug`: character-focused summary and details
- `string`, `text`, `structured_text`: full live analytics
- `seo`: title and description character counts, e.g. `Title 48 / 60 chars · Description 132 / 160 chars`

### SEO fields

The plugin attaches the counter to SEO fields with a "Limit title length" (`title_length`) or "Limit description length" (`description_length`) validation.
It reads the limits from those validators:

- Max only: the counter shows `48 / 60`.
- Min and max: the counter shows `48 / 30–60`.
- No validator for that part: the counter shows the count with no limit.

The counter turns red when the text is longer than the max, or shorter than the min.
An empty title or description never counts as too short.
SEO fields show counts only, with no word analytics or details panel.

To add the counter to an SEO field without length validations, add the "Character counter" addon in the field's Presentation settings.

The counter appears below the SEO field.
The plugin SDK can't add counters inside the native SEO title and description inputs.

All metrics update live as the editor types.

Works with the following field types:

* Slug
* Single-line string
* Multiple-paragraph text
* Structured text
* SEO meta tags
