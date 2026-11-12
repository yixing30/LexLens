"""Build compact local English assets from a pinned ECDICT CSV snapshot.

Usage: python3 scripts/build_english_data.py /path/to/ecdict.csv
The source CSV is deliberately not bundled; derived files retain attribution.
"""

import csv
import hashlib
import json
import re
import sys
from pathlib import Path


SOURCE_SHA256 = "d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc"
ROOT = Path(__file__).resolve().parents[1]
POS_PREFIX = re.compile(r"^(n|v|vi|vt|adj|a|adv|ad|prep|conj|pron|int|num|art|abbr)\.\s*", re.I)
CHINESE_GLOSS = re.compile(r"[\u3400-\u9fff]{2,10}\Z")
WORD = re.compile(r"[a-z]{3,24}\Z")


def main(path: Path) -> None:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        raise SystemExit(f"Source SHA-256 mismatch: {digest}")

    lookup = {}
    automatic = {}
    details = {}
    with path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            word = (row.get("word") or "").strip()
            translation = (row.get("translation") or "").strip().replace("\\n", "\n")
            if not WORD.fullmatch(word) or not translation:
                continue
            try:
                rank = int(row.get("frq") or 0)
            except ValueError:
                continue
            if not 0 < rank <= 50000:
                continue

            # Active lookup is explicitly an undisinambiguated dictionary entry.
            normalized = "\n".join(line.strip() for line in translation.splitlines() if line.strip())
            lookup[word] = [normalized[:300], rank]
            phonetic = (row.get("phonetic") or "").strip().replace("ә", "ə")
            definition = (row.get("definition") or "").strip().replace("\\n", "\n")
            if phonetic or definition:
                details[word] = [phonetic[:100], definition[:700]]

            # Automatic glosses use only conservative, single-line Chinese entries.
            # Inflected headwords whose exchange field points to a lemma are excluded.
            if rank <= 3500 or "0:" in (row.get("exchange") or "") or "\n" in normalized:
                continue
            match = POS_PREFIX.match(normalized)
            gloss = normalized[match.end():].strip() if match else normalized
            if CHINESE_GLOSS.fullmatch(gloss):
                automatic[word] = [gloss, rank, match.group(1).lower() if match else ""]

    data_dir = ROOT / "data"
    data_dir.mkdir(exist_ok=True)
    compact = lambda value: json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    (data_dir / "english-auto.js").write_text(
        "/* ECDICT-derived single-gloss entries; see data/NOTICE.md */\n"
        "globalThis.LexLensEnglishAuto = " + compact(automatic) + ";\n", encoding="utf-8")
    (data_dir / "english-lookup.json").write_text(compact(lookup) + "\n", encoding="utf-8")
    (data_dir / "english-detail.json").write_text(compact(details) + "\n", encoding="utf-8")
    print(f"automatic={len(automatic)} lookup={len(lookup)} detail={len(details)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
