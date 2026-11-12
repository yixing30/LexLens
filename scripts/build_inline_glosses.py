"""Generate short inline Chinese dictionary glosses for sourced English headwords.

The input is the already pinned local ECDICT extract. This creates a reusable
word index, not page-specific annotations.
"""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHINESE = re.compile(r"[\u3400-\u9fff]")
PART = re.compile(r"^(n|v|vi|vt|adj|a|adv|ad|prep|conj|pron|int|num|art|abbr)\.\s*", re.I)
OTHER_PREFIX = re.compile(r"^(?:pl|pt|pp)\.\s*", re.I)
BRACKET = re.compile(r"\[[^\]]*\]|\([^)]*\)")


def short_gloss(line: str) -> str:
    line = PART.sub("", line.strip())
    line = OTHER_PREFIX.sub("", line)
    line = BRACKET.sub("", line).strip()
    if not CHINESE.search(line):
        return ""
    choices = []
    for part in re.split(r"[,，;；、]", line):
        part = part.strip().strip("。.! ")
        if CHINESE.search(part) and len(part) <= 12 and part not in choices:
            choices.append(part)
        if len(choices) == 2:
            return "／".join(choices)
    if choices:
        return choices[0]
    return ""


def normalized_pos(part: str) -> str:
    if part in {"vi", "vt"}:
        return "v"
    if part == "adj":
        return "a"
    if part == "ad":
        return "adv"
    return part


def gloss_by_pos(translation: str, parts: set[str]) -> dict[str, str]:
    lines = translation.splitlines()
    result = {}
    for line in lines:
        match = PART.match(line.strip())
        if match:
            part = normalized_pos(match.group(1).lower())
            if part in parts and part not in result:
                gloss = short_gloss(line)
                if gloss:
                    result[part] = gloss
    fallback = next((gloss for line in lines if (gloss := short_gloss(line))), "")
    if fallback:
        result["_"] = fallback
    return result


def main() -> None:
    level_source = (ROOT / "data/english-levels.js").read_text(encoding="utf-8")
    level_json = re.search(r"LexLensEnglishLevels = (\{.*?\});", level_source).group(1)
    levels = json.loads(level_json)
    dictionary = json.loads((ROOT / "data/english-lookup.json").read_text(encoding="utf-8"))
    glosses = {word: gloss for word, evidence in levels.items()
               if word in dictionary
               if (gloss := gloss_by_pos(dictionary[word][0], {row[0] for row in evidence}))}
    target = ROOT / "data/english-inline.js"
    target.write_text(
        "/* Short ECDICT common meanings for inline display; see data/NOTICE.md. */\n"
        "globalThis.LexLensEnglishInline = "
        + json.dumps(glosses, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        + ";\n", encoding="utf-8")
    print(f"inline dictionary headwords={len(glosses)} / {len(levels)}")


if __name__ == "__main__":
    main()
