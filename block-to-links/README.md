# DatoCMS Block to Links Plugin

A powerful plugin for DatoCMS that automates the conversion of Modular Blocks into independent Models. This tool helps you refactor your content architecture by extracting embedded blocks into reusable records, preserving all your existing content and relationships.

## Features

- **Automated Refactoring**: Converts a Block Model into a full-fledged Item Type (Model).
- **Data Migration**: Automatically migrates all existing block instances into new records.
- **Deep Reference Updates**: Updates all fields referencing the old block (Modular Content, Structured Text) to use links to the new records instead.
- **Nested Block Support**: Handles blocks nested within other blocks or localized fields.
- **Structured Text Compatible**: Seamlessly migrates blocks within Structured Text fields, converting them to appropriate record links and preserving rich content structure.
- **Flexible Options**: Choose to fully replace the old block or keep it alongside the new model for safety.

![Demo](docs/StructuredTextDemo.gif)

## How to Use

1. **Install the Plugin**: Add the plugin to your DatoCMS project via the Plugins area.
3. **Navigate to Settings**: Go to the plugin's configuration screen in your project settings.
4. **Select a Block**: Choose the Modular Block model you want to convert from the dropdown menu.
5. **Analyze**: The plugin will scan your project to find where this block is used and how many records will be affected.
6. **Configure Conversion**:
    - **Fully replace original block**: 
        - *Enabled*: Deletes the old block model and its data after successful conversion. The new links field replaces the old block field.
        - *Disabled*: Keeps the old block model and data. Adds a new "Links" field alongside the existing block field.
    - **Publish records after changes**:
        - *Enabled*: Automatically publishes records after they are updated with the new links.
        - *Disabled*: Updates records but leaves them in their current draft/published state (updated records will be in draft).
7. **Convert**: Click the conversion button. The plugin will show a progress bar as it creates the model, migrates content, and updates references.

## What it does

When you run a conversion, the plugin performs the following actions:

1.  **Model Creation**: Creates a new Model (Item Type) that mirrors the structure of your selected Block. All fields (text, images, etc.) are replicated.
2.  **Content Migration**: Iterates through all your content. Wherever it finds an instance of your Block, it creates a corresponding new Record in the new Model.
3.  **Reference Updates**:
    - **Modular Content Fields**: Replaces the "Block" usage with a link to the newly created Record.
    - **Structured Text**: Transforms block nodes into inline item links.
4.  **Cleanup (Optional)**: If "Fully replace" is selected, it removes the old Block definition and cleans up the old data fields.

## ⚠️ Important: Frontend Updates Required

After converting a Block to a Model, you will need to update your GraphQL queries in your frontend application. The syntax for fetching linked records differs from fetching inline blocks:

- **Modular Content Fields**: Instead of querying for the block type directly (e.g., `... on YourBlockRecord`), you will now query the new link field which references the new model.
- **Structured Text**: Blocks within Structured Text are converted to **Inline Item** links. You will need to update your queries to fetch `links` instead of `blocks` and handle the `inline_item` node type in your renderer (e.g., `datocms-structured-text`).

## Safety & Best Practices

- **Backup**: While this plugin is designed to be safe, modifying content architecture is a major change. We recommend testing this on a sandbox environment first.
- **Non-Destructive Mode**: Use the "Fully replace original block" option (disabled by default) with caution. You can run the conversion without it first to verify everything looks correct, then manually delete the old block definition later, and rename the new one.
