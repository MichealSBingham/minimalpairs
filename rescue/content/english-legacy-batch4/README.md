# English legacy restoration: isolated batch 4

Prepared 2026-09-28. **Four candidate topics, 12 strict minimal pairs, 24 English words. Text checked; audio unapproved.** No main lesson, asset, generation allowance or live service is changed.

| ID | Legacy route | Target and position | Pairs |
| --- | --- | --- | --- |
| `en-dress-strut` | `/english/e-vs-uh` | /ɛ–ʌ/, medial vowel | pen–pun; ten–ton; hem–hum |
| `en-n-ng` | `/english/n-vs-ng` | /n–ŋ/, final consonant | kin–king; pin–ping; win–wing |
| `en-t-d` | `/english/t-vs-d` | /t–d/, initial consonant | tip–dip; tie–die; town–down |
| `en-strut-ah` | `/english/uh-vs-ah` | /ʌ–ɑ/, medial vowel; **American dialect adaptation** | rut–rot; hut–hot; nut–not |

The old last route declares /ʌ–ɑː/ and gives a non-rhotic cup–carp example. The new LOT words use /ɑ/ in the selected American dictionary forms; in many British accents they would have /ɒ/, not /ɑː/. This is a disclosed dialect adaptation, not just removal of a length mark. Use a consistent American set and keep British/non-rhotic voices and word pools separate.

Every selected IPA and intended sense was read in the **Webster’s New World American English entry hosted by Collins**. The source audit identifies exact entries, including weight-unit ton, verb hum rather than the /həm/ interjection, singular game-cube die, and standalone not. Meanings are short original labels. No dictionary audio or paragraphs were copied.

Each reference pair has two eligible different-word X choices per category within its contrast and target-position group: **48 combinations** overall. The default remains audio-only cross-word ABX, “Which reference shares X’s target sound?” The focus instruction explicitly changes between initial consonant, final nasal and middle vowel. Do not add /ɡ/ after the final /ŋ/ or trim the nasal tail away.

Exclusions are scoped correctly: current training and batches2/3 exclude English spelling and normalized English IPA; reserved assessments exclude spellings across languages plus normalized English IPA. The French training words spelled ton and pin do not exclude the independently sourced English words. This is new English training vocabulary, not a claim of unseen material for every multilingual learner.

## Artifacts and checks

- `candidates.json`: four contrast objects with IPA tokens, category order, position/groups, dialect notes and audio-only ABX metadata.
- `source-audit.json`: 24 selected primary pronunciation/sense records, original gloss policy, exclusions and phonetic references.
- `selection-evidence.json`: exact legacy route/component/category declarations, scoped exclusions, source hashes and the remaining four-topic gap.
- `audio-request.json`: 24 exact words and pronunciation notes; **48 clips for two complete profiles**, zero approved. This file authorizes no synthesis.
- `validation.json`: one-phoneme and category checks, 48 eligible X combinations, inventory/exclusion checks and 14 rejected negative controls.
- `build_candidates.py` and `audit.py`: reproducible generation/validation confined to this folder. Validation is offline; it does not reread dictionaries or judge recordings.

Run from the repository root:

```sh
python3 rescue/content/english-legacy-batch4/build_candidates.py
python3 rescue/content/english-legacy-batch4/audit.py
```

At this baseline six English topics are integrated; batch2 has four isolated candidates, batch3 six, and batch4 four. Later integration of all candidates would make **20/24 starter topics**, including the disclosed dialect adaptation. Voiced-th-vs-d, voiced-th-vs-z, aw-vs-o and v-vs-b still require work. This does not restore the whole former paid word library, approve voices or establish any learning/revenue result.

Evidence report: `research/english-legacy-batch4-2026-09-28.md` at the repository root.
