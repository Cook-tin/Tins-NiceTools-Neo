# Contributing

Thanks for taking a look at NiceTools Neo.

## Before opening a PR

1. Use Windows 10/11 x64.
2. Run `npm run check`.
3. If your change touches the engine or export path, run the relevant tests in
   `tests/` after fetching FFmpeg and generating the test media.
4. Keep the renderer dependency-free: `app/renderer/js/*.js` are classic scripts
   loaded in order by `app/renderer/index.html`. Do not add a bundler or ES
   module imports to the renderer without discussing it first.

## Areas that need extra care

- `app/lib/commands.js` and `app/lib/exporter.js`: FFmpeg arguments and export
  behavior.
- `app/preload.js`: only expose explicitly allowlisted IPC channels.
- `app/lib/mcsounds/`: MC音效 scanning/download/drag path and filesystem safety.
- `update-notice.json` / `NiceToolsUpdater2.exe`: the updater intentionally
  keeps the selected update package.

## Pull request scope

Small, focused fixes are easiest to review. If a change affects the UI, include
a screenshot or a short screen recording; if it affects exports, include the
input codec/container and the command that was tested.

## License

By contributing, you agree that your contribution is licensed under the MIT
License, matching the project license (see `LICENSE`).
