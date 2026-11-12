"""Build the compact A1–C2 level index from cited CEFR-J and Octanove sources.

Usage: python3 scripts/build_english_levels.py CEFRJ_wordlist_ver1.6.zip octanove-vocabulary-profile-c1c2-1.0.csv
"""

import csv
import hashlib
import io
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CEFRJ_SHA256 = "c837d2c00ab8954ed8db48e79afd8ef37099570295fec36950dbf9322303a37a"
OCTANOVE_SHA256 = "18c33a407f2f89f7b8de9671c6d45fe3ea0bce45e7d2d7dcaab48d73e0f7b380"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
WORD = re.compile(r"[a-z]{2,24}\Z")
POS = {"noun": "n", "verb": "v", "adjective": "a", "adverb": "adv",
       "pronoun": "pron", "preposition": "prep", "determiner": "det",
       "conjunction": "conj", "number": "num", "modal auxiliary": "modal",
       "be-verb": "be", "do-verb": "do", "have-verb": "have",
       "interjection": "int", "infinitive-to": "to"}
LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}


def verify(path: Path, expected: str) -> None:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected:
        raise SystemExit(f"Source SHA-256 mismatch for {path}: {digest}")


def cefrj_rows(path: Path):
    with zipfile.ZipFile(path) as outer:
        with zipfile.ZipFile(io.BytesIO(outer.read("CEFR-J Wordlist Ver1.6.xlsx"))) as book:
            shared = ["".join(t.text or "" for t in item.findall(".//m:t", NS))
                      for item in ET.fromstring(book.read("xl/sharedStrings.xml"))]
            sheet = ET.fromstring(book.read("xl/worksheets/sheet2.xml"))
            for row in sheet.findall(".//m:sheetData/m:row", NS)[1:]:
                values = {}
                for cell in row.findall("m:c", NS):
                    value = cell.find("m:v", NS)
                    if value is None:
                        continue
                    column = re.match(r"[A-Z]+", cell.attrib["r"]).group()
                    values[column] = shared[int(value.text)] if cell.attrib.get("t") == "s" else value.text
                yield values.get("A", "").lower(), values.get("B", "").lower(), values.get("C", "")


def main(cefrj: Path, octanove: Path) -> None:
    verify(cefrj, CEFRJ_SHA256)
    verify(octanove, OCTANOVE_SHA256)
    rows = defaultdict(lambda: defaultdict(set))
    for word, part, level in cefrj_rows(cefrj):
        if WORD.fullmatch(word) and part in POS and level in LEVELS:
            rows[word][POS[part]].add((level, "CEFR-J v1.6"))
    with octanove.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            word, part, level = row["headword"].lower(), row["pos"].lower(), row["CEFR"]
            if WORD.fullmatch(word) and part in POS and level in {"C1", "C2"}:
                rows[word][POS[part]].add((level, "Octanove v1.0"))

    # Conflicting levels for the same word and part of speech are withheld.
    index = {}
    conflicts = 0
    for word, parts in sorted(rows.items()):
        resolved = []
        for part, evidence in sorted(parts.items()):
            if len({level for level, _source in evidence}) != 1:
                conflicts += 1
                continue
            level, source = sorted(evidence)[0]
            resolved.append([part, level, source])
        if resolved:
            index[word] = resolved
    output = ROOT / "data" / "english-levels.js"
    lookup_headwords = set(json.loads((ROOT / "data" / "english-lookup.json").read_text(encoding="utf-8")))
    output.write_text(
        "/* CEFR-J v1.6 and Octanove v1.0; see data/ENGLISH-LEVELS-NOTICE.md */\n"
        "globalThis.LexLensEnglishLevels = "
        + json.dumps(index, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + ";\n"
        "globalThis.LexLensEnglishLookupHeadwords = "
        + json.dumps(sorted(lookup_headwords.intersection(index)), separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"level headwords={len(index)} items={sum(map(len, index.values()))} withheld conflicts={conflicts}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
