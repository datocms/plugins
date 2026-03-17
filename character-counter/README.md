# Character Counter

A DatoCMS plugin that automatically adds a compact text analytics addon to fields configured with length validation.

By default, the addon stays quiet and shows a one-line summary with the most important metrics. Editors can expand it when they want more detail.

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

All metrics update live as the editor types.

Works with the following field types:

* Slug
* Single-line string
* Multiple-paragraph text
* Structured text
