# English legacy restoration: isolated batch 5

Prepared 2026-09-28. **Four candidate topics, 12 strict minimal pairs, 24 words. Text checked; audio unapproved.** Nothing is integrated, generated or deployed.

| ID | Exact legacy topic | Position and locale | Pairs |
| --- | --- | --- | --- |
| `en-dh-d` | `/english/voiced-th-vs-d`, /ð–d/ | initial, en-US | they–day; then–den; though–dough |
| `en-dh-z` | `/english/voiced-th-vs-z`, /ð–z/ | final, en-US | breathe–breeze; seethe–seize; teethe–tease |
| `en-v-b` | `/english/v-vs-b`, /v–b/ | initial, en-US | very–berry; vote–boat; volt–bolt |
| `en-thought-lot-gb` | `/english/aw-vs-o`, /ɔː–ɒ/ | medial, **non-rhotic en-GB** | port–pot; court–cot; short–shot |

The British pool is **blocked on explicit contrast-level British profile routing plus pronunciation review**. Current English selection has an en-US default and language-level voice matching; the candidate metadata alone does not enforce a dialect in the application. Never load these pairs with rhotic American /ɹ/ or substitute /ɑ/ for /ɒ/. A/B and X must use separate complete voices of the same selected dialect. A generic en-GB label also does not certify the required pronunciations.

All 18 American entries were read in Webster’s New World College Dictionary, hosted by Collins; all six British entries were read in Collins English Dictionary’s British blocks. `source-audit.json` identifies exact IPA, source section and intended sense. Very/berry retain equal first-syllable stress; volt means the electrical unit. Breathe and teethe are verbs, distinct from breath and teeth.

Every reference pair has two eligible different X words per category in its position-compatible group: **48 combinations**. In the final-consonant pool, breathe/breeze have target token index 3 while seethe/seize and teethe/tease have index 2. The checks use each X pair’s own target index, not the reference word’s length. Text remains hidden until the answer or explicit help.

Exclusions cover current and earlier candidate **English** spellings/IPA, plus reserved assessment spellings across all languages and reserved English IPA. Conservative homophone checking strips stress/length notation for exposure comparison only; the actual British curriculum phoneme tokens retain /ɔː/ and /ɒ/.

## Artifacts

- `candidates.json`: four isolated contrast objects, with explicit per-contrast audio locale and British integration gate.
- `source-audit.json`: 24 selected primary IPA/sense facts, editorial normalization and licensing boundaries.
- `selection-evidence.json`: exact old route/component/category bindings, seven baseline hashes and honest conditional coverage.
- `audio-request.json`: **36 clips for 18 words across two American profiles, plus 12 clips for six words across two separate British profiles**. Zero approved; no synthesis authorization.
- `validation.json`: 12 minimal-pair checks, 48 X combinations, 21 negative controls, seven unchanged baselines.
- `build_candidates.py`, `audit.py`: isolated reproducible construction and offline validation.

```sh
python3 rescue/content/english-legacy-batch5/build_candidates.py
python3 rescue/content/english-legacy-batch5/audit.py
```

The authoritative inventory still has **six integrated English topics of 24**. Batches2–5 supply text candidates for all 18 missing topics, not 18 released lessons. Three prior batches plus the three American pools here could bring the American reference to 23 topics after audio and integration work. The last British topic requires its separate dialect support. This does not establish full former-library depth, approved recordings, transfer gains, retention or revenue.

Evidence report: `research/english-legacy-batch5-2026-09-28.md` at the repository root.
