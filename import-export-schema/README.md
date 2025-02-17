# DatoCMS Schema Import/Export Plugin

A powerful plugin for DatoCMS that enables seamless schema migration between projects through JSON import/export functionality.

## Features

- Export single or multiple models/block models as JSON files
- Import models into different DatoCMS projects
- Smart conflict resolution with guided instructions
- Automatic plugin dependency detection and inclusion
- Safe import operations that preserve existing schema

## Safety Features

As a security measure, this plugin is designed to never modify existing schema entities in the target project during JSON imports. It only adds new entities to the project, making the operation completely safe and non-destructive.

## Installation

1. Navigate to your DatoCMS environment configuration
2. Go to the Plugins section
3. Search for "Schema Import/Export"
4. Click Install

## Usage

### Exporting Models

1. In the Schema section, navigate to one of your models/block models
2. Select the "Export as JSON..." option
3. If the model/block model references other models/block models, you can decide to export them as well
4. Save the generated JSON file

### Importing Models

1. Navigate to your DatoCMS environment configuration
2. Go to the Import/Export section
3. Drop your JSON file
4. Follow the conflict resolution prompts if any appear
5. Confirm the import

## Conflict Resolution

When importing models, the plugin will:

- Detect potential conflicts with existing schema
- Provide clear instructions for resolving each conflict
- Allow you to review changes before applying them

## Dependencies

The plugin automatically handles the following dependencies:

- Required field plugins
- Block model relationships
- Field validations
- Field appearance settings
