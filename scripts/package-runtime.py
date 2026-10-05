#!/usr/bin/env python3
"""Package the JavaScript runtime on macOS or Linux without mutating node_modules."""
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "android/app/src/main/assets"


def include(info):
    if ".bin" in Path(info.name).parts:
        return None
    if info.issym() and not (ROOT / info.name).exists():
        return None
    return info


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    runtime = ROOT / "runtime"
    if not (runtime / "node_modules").is_dir():
        raise SystemExit("Run npm ci --omit=dev --omit=optional --ignore-scripts in runtime first")
    manifest = ASSETS / "termux-packages.json"
    if not manifest.is_file():
        raise SystemExit("Run scripts/package-rootfs.py first to generate the baseline package manifest")
    with tarfile.open(ASSETS / "runtime.bin", "w:gz", format=tarfile.USTAR_FORMAT) as archive:
        archive.add(manifest, arcname="runtime/termux-packages.json")
        for file in sorted(runtime.glob("*.mjs")):
            archive.add(file, arcname="runtime/" + file.name, filter=include)
        for name in ("package.json", "package-lock.json", "public", "node_modules"):
            archive.add(runtime / name, arcname="runtime/" + name, filter=include)


if __name__ == "__main__":
    main()
