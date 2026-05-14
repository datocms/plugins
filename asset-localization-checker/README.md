# Asset Localization Checker

A field add-on for single asset fields that shows whether title and alt text are filled in for every locale used in the record. It looks at both the asset's default per-locale metadata and any field-level overrides, and indicates which locales are still missing values, which were overridden by the field, and which are OK.

To use, simply install the plugin. It is automatically attached to every single-asset file field in the project. Multi-asset (gallery) fields are not supported.

The plugin uses the editor's current user access token to fetch the asset's metadata, so make sure that permission is granted when installing.

# Version History
- 0.2.1: Moved plugin to official DatoCMS plugins repository. This was just an organizational change and does not add any features or fixes.
- 0.2.0: Initial alpha release
