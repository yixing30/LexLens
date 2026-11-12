# English level evidence

`english-levels.js` is derived from two public vocabulary profiles. It stores headword, part of speech, and level, plus a list of headwords present in the bundled ECDICT lookup file. It does **not** provide a level for each meaning in a sentence.

- A1–B2: *The CEFR-J Wordlist Version 1.6*, compiled by Yukio Tono, Tokyo University of Foreign Studies, retrieved 2026-11-12 from <https://cefr-j.org/download_eng>. The official project permits use with source acknowledgement. Source ZIP SHA-256: `c837d2c00ab8954ed8db48e79afd8ef37099570295fec36950dbf9322303a37a`.
- C1–C2: *Octanove Vocabulary Profile C1/C2 Version 1.0*, Octanove Labs, retrieved 2026-11-12 from <https://github.com/openlanguageprofiles/olp-en-cefrj>. Licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Source CSV SHA-256: `18c33a407f2f89f7b8de9671c6d45fe3ea0bce45e7d2d7dcaab48d73e0f7b380`.

The C1–C2 portion of the derived index is distributed under CC BY-SA 4.0 with this attribution; modifications to that portion must follow the same license.

`scripts/build_english_levels.py` reproduces the compact index from these files and the already built `data/english-lookup.json`. Conflicting grades for the same spelling and part of speech are withheld. A matching profile level is evidence about a headword and grammatical class, not proof of the current sentence's meaning or a guarantee that any particular learner knows it.
