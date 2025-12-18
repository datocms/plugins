# DatoCMS Project Exporter Plugin

A powerful DatoCMS plugin that allows you to export your project's records and assets directly from the dashboard. Whether you need a complete backup, a specific set of data for analysis, or just a single record, Project Exporter handles it with support for multiple popular formats.

![Project Exporter Preview](docs/cover.png)

## Features

- **Multiple Export Formats**: Export your data in JSON, CSV, XML, or XLSX.
- **Bulk Record Export**: Download all records in your project.
- **Filtered Exports**:
  - **By Model**: Select specific models to export records from.
  - **By Text Search**: Export records matching a specific search query.
- **Asset Export**: Download all your project assets bundled in a ZIP file.
- **Single Record Export**: Download the current record directly from the content editor sidebar.

## Installation

1.  Go to your DatoCMS project dashboard.
2.  Navigate to **Settings** > **Plugins**.
3.  Click the **Plus** icon to add a new plugin.
4.  Search for **Project Exporter** or install it manually using the package name `datocms-plugin-project-exporter`.

## Configuration

Once installed, you can configure the default export format in the plugin settings:

1.  Navigate to **Settings** > **Plugins**.
2.  Click on **Project Exporter**.
3.  In the configuration area (or via the plugin's main page), you can select your preferred default format:
    - `JSON`
    - `CSV`
    - `XML`
    - `XLSX`

*Note: You can also change the format on-the-fly when performing an export.*

## Usage

### Exporting Records (Bulk)

To perform bulk exports, navigate to the plugin's configuration screen (typically found under **Settings** > **Plugins** > **Project Exporter** > **Config Screen** or the dedicated plugin page if applicable).

1.  **Select Format**: Choose between JSON, CSV, XML, or XLSX from the dropdown menu.
2.  **Filter by Model**: Use the dropdown to select one or multiple models. Click "Download records from selected models" to export only those records.
3.  **Filter by Text**: Enter a search term in the text field. Click "Download records from text query" to export matches.
4.  **Export All**: Click "Download all records" to export everything.

### Exporting Assets

1.  On the main plugin screen, click the **Download all assets** button.
2.  The plugin will fetch all assets and bundle them into a `allAssets.zip` file for download.

*Note: For extremely large projects with thousands of assets, it is recommended to use the [official DatoCMS export script](https://www.datocms.com/docs/import-and-export/export-data) to avoid browser timeout issues.*

### Exporting a Single Record

When editing a specific record:

1.  Look for the **Record Downloader** panel in the right sidebar.
2.  Click **Download this record**.
3.  The record will be downloaded in the format currently selected in the plugin's global configuration.

## Development

This plugin is built with React and the DatoCMS Plugin SDK. To contribute or modify the plugin locally:

1.  Clone the repository:
    ```bash
    git clone https://github.com/marcelofinamorvieira/datocms-plugin-project-exporter.git
    ```
2.  Install dependencies:
    ```bash
    npm install
    # or
    pnpm install
    ```
3.  Start the development server:
    ```bash
    npm start
    ```
4.  Follow the [DatoCMS Plugin SDK documentation](https://www.datocms.com/docs/plugins/sdk) to link your local server to a DatoCMS project for testing.

## Tech Stack

- **Framework**: React, TypeScript
- **DatoCMS**: `@datocms/plugin-sdk`, `@datocms/react-ui`
- **Utilities**: 
  - `json-2-csv` (CSV generation)
  - `jsontoxml` (XML generation)
  - `xlsx` (Excel generation)
  - `jszip` (Asset zipping)

## License

This project is licensed under the MIT License.
