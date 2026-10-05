# Schema Import/Export

Exports models and blocks, along with the plugins their fields use, to a JSON file, and imports that file into another DatoCMS project or environment. When something in the file already exists in the target, you decide how to handle each conflict before anything is created.

Install the plugin and allow it to use the current user's API token. It moves schema only, not records or assets.

## Exporting

Go to **Configuration → Schema → Export** and pick the models and blocks to start from, or click **Export entire schema**. To start from a single model, open it in the schema editor, click the three dots next to its name and choose **Export as JSON...**.

The export page shows the selection as a graph. **Select all dependencies** adds every model, block and plugin they link to. Validators that point to models outside the selection are removed, and fields whose editor plugin isn't part of the export fall back to a built-in editor, so the file works on its own. When the export finishes, `export.json` downloads.

With more than about 60 models and blocks, the page shows a warning instead of drawing the graph. You can still select dependencies and export, or click **Render it anyway**.

If the list of installed plugins can't be loaded, you'll see a warning and the export may miss plugin dependencies. Reload the page and run **Select all dependencies** again.

## Importing

Go to **Configuration → Schema → Import** and drop in an export file. The plugin compares it with the current environment. For each model or block that already exists, you can reuse the existing one or import it under a different name and API key. For each plugin that's already installed, you can reuse it or leave it out.

Imports only add things. New models, blocks, fields, fieldsets and plugins are created, and nothing existing is overwritten. Validators and editors are remapped to the target project, missing editor plugins fall back to built-in editors, and localized defaults are filled in for every locale in the target environment.

Keep the page open while an import runs. There's no rollback, so if you cancel or the import fails partway, whatever was already created stays in the project.

To share an export, host the file somewhere and link to the import page with `?recipe_url=<file URL>` (and optionally `&recipe_title=<title>`). The plugin loads the file and opens it ready to import.

## Development

```sh
npm ci
npm run dev
npm run check
```
