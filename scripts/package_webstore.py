"""Build a Chrome Web Store ZIP with manifest.json at the archive root."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from package_extension import FILES, OUTPUT, ROOT, main as build_extension


def main() -> None:
    build_extension()
    version = json.loads((OUTPUT / "manifest.json").read_text(encoding="utf-8"))["version"]
    archive_path = ROOT / "dist" / f"LexLens-Chrome-{version}-webstore-candidate.zip"
    with ZipFile(archive_path, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in FILES:
            archive.write(OUTPUT / relative, Path(relative).as_posix())
    with ZipFile(archive_path) as archive:
        names = archive.namelist()
        if "manifest.json" not in names or len(names) != len(FILES) or archive.testzip():
            raise SystemExit("Invalid Chrome Web Store ZIP")
    print(f"Store candidate: {archive_path}")
    print(f"Files: {len(FILES)}; Bytes: {archive_path.stat().st_size}")


if __name__ == "__main__":
    main()
