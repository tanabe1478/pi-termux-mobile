# Personal Pi Mobile

This is tanabe1478's personal Android agent application.

## Repository

- Push user-authorized commits to `origin`: https://github.com/tanabe1478/pi-termux-mobile.git.
- `upstream` is https://github.com/badlogic/pi-termux-mobile.git. Do not push there.
- Current development device: Galaxy SM-S931Z, Android 16/API 36, ARM64. Do not assume it is always connected.

## Checks and device deployment

- Run `node --test runtime/test/*.test.mjs`, JavaScript syntax checks, and `git diff --check`.
- Build assets with `python3 scripts/package-rootfs.py` on first setup and `python3 scripts/package-runtime.py` after runtime changes.
- Increment `RUNTIME_VERSION` in `RuntimeInstaller.java` when changing bundled runtime assets.
- Build with Java 21 and Android SDK 35: `cd android && ./gradlew --no-daemon assembleDebug` (set ANDROID_HOME as needed).
- Updating the connected phone should preserve its data: use `adb install -r`, not uninstall or clear-data.
- Before stopping the app, account for active work. Durable recovery does not mean arbitrary tools are safe to replay.

## Privacy and permission boundaries

- Never commit or print credentials, OAuth callback codes, auth.json, device conversation databases, screenshots, APKs, or signing keys.
- Read device conversations only when needed and authorized. Do not send personal device data to GitHub.
- Device state is a native, read-only, timestamped snapshot. It currently exposes model/OS, battery and network flags, not location, SSID, IP, identifiers or other apps' private data.
- Do not grant ADB/root privileges or change Android security/battery/system settings without specific user approval.
- Prefer standard CLIs/scripts over per-feature tools. Use `pi-pkg plan PACKAGE` and obtain approval before `pi-pkg install PACKAGE --yes`. `gh` uses the saved app credential; do not run token-display commands. The additive installer is not a complete apt/dpkg environment and does not execute maintainer scripts.
- Self-improvement must distinguish runtime extension changes from APK/native updates. System writes need scoped capabilities, visible approval, verification and a rollback plan.
