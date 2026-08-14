# Releases and updates

Fable uses immutable versioned installers rather than silent in-app self-update in v0.1. Operators choose when to replace the installed application, which avoids changing an autonomous execution host during a run.

## Release workflow

1. Update the version consistently in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run all quality gates and validate a packaged sidecar startup.
3. Tag `v<version>`.
4. The installer workflow builds native artifacts on macOS, Windows, and Linux GitHub runners and creates a draft prerelease.
5. Review checksums/artifacts, sign and notarize where credentials are configured, test a clean-machine install, then publish.

Expected formats are macOS `.app`/`.dmg`, Windows NSIS `.exe`/`.msi`, and Linux AppImage/`.deb`. Cross-compiling desktop webview applications is not treated as release validation; every platform builds natively.

## Signing

Production macOS releases should configure `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, and `APPLE_SIGNING_IDENTITY`, plus notarization credentials supported by Tauri. Windows code-signing credentials should be added before calling artifacts production-ready. Local unsigned builds are for development only.

## Operator update procedure

Wait for active runs to reach a terminal state, back up state, stop Fable, verify the downloaded artifact/checksum/signature, install the new version, and start it. Startup migrations and interrupted-state reconciliation run before scheduling. Validate providers and scheduler status after every update. Rollback means stopping the service and reinstalling the prior immutable artifact; database downgrade is not promised, so preserve a pre-update backup.
