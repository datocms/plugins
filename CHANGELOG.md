# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 2021-10-11

- Added Rich Editor plugin

## 2021-03-16

- Inverse Relations - fixed the plugin. CMS is not fetching all fields by default anymore so we introduced a new method `plugin.loadItemTypeFields` that allows the user to make a GET request and fetch required fields.

## 2020-03-07

### Added

- Field anchor menu - A plugin that creates a sidebar menu that link to the fields in your record.
- Conditional fields - added a new option, `invert`, that inverts the logic of conditional fields - ie. show slave fields if master boolean is false.

### Fix

- Yandex translate - Now it works if all_locales_required = false
- Upgraded all dependencies and SDK
- Removed localtunnel
