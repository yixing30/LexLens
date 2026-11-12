# English lexical data

`english-auto.js`, `english-lookup.json`, and `english-inline.js` are derived from the [ECDICT English–Chinese dictionary](https://github.com/skywind3000/ECDICT), copyright (c) 2025 Linwei, distributed by its repository under the MIT license. The license text is included in [ECDICT-LICENSE.txt](ECDICT-LICENSE.txt).

Source file: `ecdict.csv` from `skywind3000/ECDICT` on 2026-11-12, SHA-256 `d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc`. `scripts/build_english_data.py` documents the exact transformation. Only ranked lowercase English entries with Chinese translations are retained. The original CSV is not shipped.

The source's `frq` field is a corpus rank, **not a CEFR level**. LexLens uses it only in the optional “包含粗略估计” mode to make a provisional reading-difficulty estimate and labels every such result as an estimate. The default “词表分级” mode uses CEFR-J and Octanove word grades and displays short ECDICT common meanings above eligible words. `scripts/build_inline_glosses.py` extracts these reusable meanings from the pinned local dictionary and selects an entry matching the sourced part of speech where possible. They are **not** sentence-level translations: polysemy, inflection, and specialized usage can still make a gloss wrong. Clicking a word opens the fuller local dictionary entry.

The upstream repository states an MIT license, while its README describes vocabulary assembled from several earlier sources. A public release or redistribution of this derived dataset should include a separate provenance review of those inputs.
