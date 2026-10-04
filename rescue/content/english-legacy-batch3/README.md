# English legacy restoration: isolated batch 3

Prepared 2026-09-28. **Six missing legacy topics, 18 strict minimal pairs, 36 new English words. Text checked; audio unapproved.** This folder changes no live lessons, assets, spend limits or generation allowlists.

| Contrast ID | Legacy route | Category order | Three pairs |
| --- | --- | --- | --- |
| `en-s-z` | `/english/s-vs-z` | /s/, /z/ | sip–zip; seal–zeal; sink–zinc |
| `en-f-v` | `/english/f-vs-v` | /f/, /v/ | fan–van; fat–vat; fail–veil |
| `en-p-b` | `/english/p-vs-b` | /p/, /b/ | pea–bee; peg–beg; peach–beach |
| `en-k-g` | `/english/k-vs-g` | /k/, /ɡ/ | coat–goat; curl–girl; came–game |
| `en-sh-s` | `/english/sh-vs-s` | /ʃ/, /s/ | shack–sack; shell–sell; shock–sock |
| `en-sh-ch` | `/english/sh-vs-ch` | /ʃ/, /tʃ/ | shop–chop; shin–chin; shoe–chew |

All targets are initial consonants in monosyllables, followed by a vowel. `/tʃ/` is one affricate phoneme, despite its two-character spelling. Each reference pair has two eligible X words per category, in the same trial group and excluding both reference texts: 72 possible reference-pair/X-word/category combinations overall. The task remains audio-only cross-word ABX: “Which reference shares X’s target sound?”

Primary evidence is the explicitly selected **Webster’s New World American English entry hosted by Collins**, read separately for every word. The source audit records dictionary IPA, the selected lexical entry/sense, exact URL, normalization and listening status. Meanings are original short labels. Other dictionaries on the same page may use different transcription conventions. No dictionary audio, paragraphs or chart artwork were copied.

Keep each contrast’s `dialectNote` when integrating. In particular: curl/girl are rhotic; shock/sock and shop/chop use the selected /ɑ/ vowel; shin is the body part; shell is not she’ll; lowercase vat is the container. /p–b/ and /k–ɡ/ explanations include release timing rather than describing the acoustic difference as only vocal-fold vibration. Never trim away the distinguishing onset of an affricate or stop.

## Files

- `candidates.json`: six isolated contrast objects, including IPA tokens, dialect notes, target/category alignment and ABX policy.
- `source-audit.json`: 36 manually verified primary dictionary records; phonetic sources and exclusions.
- `selection-evidence.json`: authoritative legacy statuses, old route/component/category bindings, baseline hashes, coverage arithmetic and honest demand limits.
- `audio-request.json`: all 36 words and recording cautions. Two complete profiles require **72 clips**; this batch approves zero and authorizes no synthesis.
- `validation.json`: 18 one-phoneme checks, 72 X combinations, current training/batch2/holdout exclusions and 13 rejected negative controls.
- `build_candidates.py`: writes only this folder’s candidate/evidence/request JSON from explicit editorial facts.
- `audit.py`: offline validation against the current external inventories; it never requests network access or approves pronunciation.

From the repository root:

```sh
python3 rescue/content/english-legacy-batch3/build_candidates.py
python3 rescue/content/english-legacy-batch3/audit.py
```

The saved hashes identify the audited baseline. The validator also reads current inventories, so later integration should trigger a fresh review of the baseline/coverage statements rather than silently reusing them. A successful structural audit does not reread the dictionary pages or validate synthesized speech.

At selection, six of 24 English legacy topics were integrated. Batch2 adds four isolated topics and this batch adds six different ones. Integrating both would bring starter-topic coverage to 16/24, leaving eight topics; **neither batch is integrated by these files**. This is not full old-library equivalence. Selection reflects defensible restoration coverage; no route traffic ranking, learning outcome or revenue increase is inferred.

Detailed evidence: `research/english-legacy-batch3-2026-09-28.md` at the repository root.
