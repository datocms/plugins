# Changelog

- 0.7.1: Simplified the installation flow by separating secret creation from deployment, keeping only the current step expanded by default, and collapsing the entire Installation section after setup. Tightened field spacing and connection status layouts, standardized each step's primary completion action, expanded accordion click targets, and removed redundant instructional copy.
- 0.7.0: Redesigned the configuration screen as a guided four-step wizard (auth secret & deploy → connect & test → backup cadence → status overview) with a top progress bar and per-step status/loading feedback. Saved plugin parameters are now the single source of truth, fixing an auth-secret desync that could make the plugin send the wrong/default token (HTTP 401). Fixed an infinite request loop on the config screen. Fresh installs auto-generate a strong shared secret, and editing it offers a "Revert to saved?" undo. Existing setups keep working with no migration.
- 0.6.13: Fixed a crash when opening the Deploy lambda menu.
- 0.6.8: Added the README preview image, moved the changelog into this file, and updated the plugin metadata to use the JPEG preview.
- 0.6.7: README update.
- 0.6.6 and prior: No changelog kept.
