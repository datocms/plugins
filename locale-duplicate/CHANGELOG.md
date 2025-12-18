# Changelog

All notable changes to the Locale Duplicate plugin will be documented in this file.

## [0.5.0] - 2025-01-26

### Added
- **Field-Level Copy Feature**: New functionality to copy individual field values between locales while editing records
  - Copy buttons on configured fields in the record editor
  - Support for string, text, structured_text, json, seo, and slug field types
  - Configuration interface to select which fields should have copy functionality
  - Locale selection modal for choosing source and target locales per field
- **Multiple Entry Points**: Plugin now supports three distinct entry points:
  - ConfigScreen: Field configuration interface
  - SettingsAreaSidebar: Mass locale duplication interface
  - FieldExtension: Field-level copy buttons in record editor
- **Plugin Parameters**: Added support for storing field configurations in plugin parameters

### Changed
- **Architecture Refactor**: Split monolithic ConfigScreen into separate components for different features
- **Navigation**: Mass duplication feature moved to Settings → Locale Duplicate for better organization
- **Configuration**: Plugin now has a dedicated configuration screen for field-level copy settings

### Improved
- **Documentation**: Updated README and added CLAUDE.md for development guidance
- **User Experience**: Clearer separation between mass duplication and field-level copying features

## [0.4.0] - 2025-04-01

### Added
- **Model Selection**: Added ability to choose specific content models for duplication
- **Detailed Operation Console**: Added real-time progress tracking with record IDs and status indicators
- **Rich Summary Page**: Added comprehensive summary view showing successful and failed records with IDs
- **Error Handling**: Improved error messaging and display for failed record updates

### Changed
- **UI Overhaul**: Complete redesign of the plugin interface for better usability and visual appeal
- **Progress Tracking**: Enhanced progress indicators with a dedicated Operation Console
- **Locale Selection**: Improved locale selection interface with clearer labeling
- **Performance**: Optimized duplication process with better feedback during operation

### Fixed
- Fixed issues with record ID display in operation logs
- Improved handling of validation errors during record updates

## [0.3.0] - Previous Release
- Various improvements and bug fixes

## [0.2.0] - Initial Public Release
- Basic locale duplication functionality
- Support for all content models
- Simple progress tracking
