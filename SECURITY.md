# Security

NiceTools Neo is a local desktop application. It does not include telemetry, an
account system, or a remote backend.

## What stays local

- Video/audio files are processed on the local machine.
- The preview media server binds to `127.0.0.1` on a random port.
- Settings, recent files, and MC音效 library paths stay in the local app data /
  `localStorage`.

## Network access

- The optional MC音效 download uses Mojang's official version manifest and
  resource CDN only.
- FFmpeg/Electron download scripts contact their official release URLs. Mirrors
  can be selected with environment variables; see `README.md`.

## Reporting

If you find a vulnerability that could lead to arbitrary code execution,
filesystem escape, or unintended network requests, please avoid posting
exploit details in a public issue. Open a private security advisory on GitHub
instead.

## Update packages

`NiceToolsUpdater2.exe` does not delete the selected update package. Update
packages are not code-signed; Windows SmartScreen may warn on first run.
