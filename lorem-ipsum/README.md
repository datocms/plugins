# Lorem Ipsum Generator

Makes it easy to fill text-style fields with dummy content while authoring
records in DatoCMS.

The plugin adds a **Generate dummy text** action to the field's dropdown menu
(the "three dots" menu next to a field) on supported fields. Clicking the
action populates the field with appropriate placeholder content; the field
must be configured for the action to appear.

## Supported field types

- Single-line string (`string`)
- Multi-paragraph text (`text`)
- Structured Text (`structured_text`)

## How the generated content adapts to the field

- **`string` fields** — generates a short title-cased sentence by default.
  When the field's predefined-format validator is set to `email` or `url`,
  the plugin generates a realistic email address or URL instead.
- **`text` fields with the Markdown editor** — generates Markdown with
  headings, paragraphs, lists, and blockquotes when the corresponding
  toolbar buttons are enabled.
- **`text` fields with the WYSIWYG editor** — generates the same article
  shape rendered as HTML, again respecting the toolbar configuration.
- **`text` fields with any other editor** — falls back to plain Lorem Ipsum
  paragraphs.
- **`structured_text` fields** — generates Structured Text DAST nodes,
  including only the node and mark types allowed by the field's editor
  configuration.

## How to enable it on a field

There are two ways to expose **Generate dummy text** on a field:

1. **Manually**, by adding the plugin as a presentation addon on the field
   from the schema editor. Once added, the dropdown action appears on that
   field for editors.
2. **Automatically**, by defining one or more **auto-apply rules** in the
   plugin's configuration screen. A rule is a combination of:
   - One or more field types (single-line string, multi-line text,
     Structured Text), and
   - A regular expression matched against the field's API key.

   Any field whose type and API key match at least one rule will surface
   the dropdown action without needing the addon to be added explicitly.

## Configuration

Open the plugin's configuration screen (Configuration → Plugins → Lorem ipsum generator) to add or remove auto-apply rules.
Each rule needs both a non-empty regexp and at least one selected field
type; invalid regexps are silently skipped at runtime so a typo never
breaks the editing experience.

Manually-added fields keep working regardless of whether any rule is
configured.
