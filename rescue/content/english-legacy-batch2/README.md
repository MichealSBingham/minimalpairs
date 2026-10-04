# English legacy restoration candidate, batch 2

Prepared 2026-09-28. **Four isolated text candidates, 12 minimal pairs, 24 exact words. Nothing in this folder approves audio or changes the main lessons.**

The selected routes are missing in the authoritative `rescue/content/legacy-coverage.json` snapshot: `/english/short-u-vs-long-oo`, `/english/ae-vs-e`, `/english/v-vs-w`, and `/english/voiceless-th-vs-f`. English then had six starter contrasts out of 24 legacy topics. This batch excludes the already-restored `/ʒ–dʒ/`, `/ʊ–ʌ/`, and `/æ–ʌ/` topics.

The saved Search Console audit, `research/revenue-operation-2026-09-27.md`, reports 49 clicks and 4,711 impressions for the English hub over June 26–September 25, with 14 clicks in the latest 28 days. Its three individually measured English contrasts are already restored. **It contains no individual demand counts for these four candidates.** Selection is an editorial restoration priority: usable lexical examples, missing legacy routes and complementary vowel/consonant coverage. It is not a claim that these are the next four highest-traffic topics or that they will generate a measured revenue lift.

## Candidate scope and primary evidence

Every link below was read in the American English section of **Webster’s New World College Dictionary, 5th Digital Edition (2025), hosted by Collins**. Pages also contain other publishers, British entries and homographs; `source-audit.json` identifies the selected entry. No dictionary audio or definition paragraphs were acquired. Meanings in the candidate are brief editorial labels.

| Candidate / category order | Exact pairs and dictionary evidence | Broad American IPA |
| --- | --- | --- |
| `en-foot-goose`: /ʊ/ then /u/ | [cook](https://www.collinsdictionary.com/us/dictionary/english/cook) / [kook](https://www.collinsdictionary.com/us/dictionary/english/kook) | /kʊk/ – /kuk/ |
| Same | [full](https://www.collinsdictionary.com/us/dictionary/english/full) / [fool](https://www.collinsdictionary.com/us/dictionary/english/fool) | /fʊl/ – /ful/ |
| Same | [pull](https://www.collinsdictionary.com/us/dictionary/english/pull) / [pool](https://www.collinsdictionary.com/us/dictionary/english/pool) | /pʊl/ – /pul/ |
| `en-trap-dress`: /æ/ then /ɛ/ | [bat](https://www.collinsdictionary.com/us/dictionary/english/bat) / [bet](https://www.collinsdictionary.com/us/dictionary/english/bet) | /bæt/ – /bɛt/ |
| Same | [mat](https://www.collinsdictionary.com/us/dictionary/english/mat) / [met](https://www.collinsdictionary.com/us/dictionary/english/met) | /mæt/ – /mɛt/ |
| Same | [bad](https://www.collinsdictionary.com/us/dictionary/english/bad) / [bed](https://www.collinsdictionary.com/us/dictionary/english/bed) | /bæd/ – /bɛd/ |
| `en-v-w`: /v/ then /w/ | [vine](https://www.collinsdictionary.com/us/dictionary/english/vine) / [wine](https://www.collinsdictionary.com/us/dictionary/english/wine) | /vaɪn/ – /waɪn/ |
| Same | [vest](https://www.collinsdictionary.com/us/dictionary/english/vest) / [west](https://www.collinsdictionary.com/us/dictionary/english/west) | /vɛst/ – /wɛst/ |
| Same | [vet](https://www.collinsdictionary.com/us/dictionary/english/vet) / [wet](https://www.collinsdictionary.com/us/dictionary/english/wet) | /vɛt/ – /wɛt/ |
| `en-th-f`: /θ/ then /f/ | [thin](https://www.collinsdictionary.com/us/dictionary/english/thin) / [fin](https://www.collinsdictionary.com/us/dictionary/english/fin) | /θɪn/ – /fɪn/ |
| Same | [three](https://www.collinsdictionary.com/us/dictionary/english/three) / [free](https://www.collinsdictionary.com/us/dictionary/english/free) | /θɹi/ – /fɹi/ |
| Same | [thirst](https://www.collinsdictionary.com/us/dictionary/english/thirst) / [first](https://www.collinsdictionary.com/us/dictionary/english/first) | /θɝst/ – /fɝst/ |

Notation is explicit: Webster /r/ becomes broad /ɹ/, and /ɜr/ becomes rhotic /ɝ/. Webster /u/ stays /u/. The old “short u vs long oo” page itself declares /ʊ–uː/; the length-mark change here is broad American notation, not a change of contrast. The old “ae vs e” page itself declares /æ–ɛ/, not /æ–eɪ/. Saved bundle component names and snapshot hashes are in `selection-evidence.json`; old labels identify the intended topic, but do not validate old examples.

## Dialect and recording limits

These are selected rhotic American dictionary citation forms, not a claim about every native English variety. Full/fool and pull/pool require special attention in the exact recordings because both pairs place the vowel before /l/. The lesson must preserve the category distinction in each profile, rather than teaching duration alone. Kook is informal and can be disparaging; its neutral vocabulary label is not a characterization of the learner.

Thirst/first must retain matched rhotic readings within each profile. Three/free include a following /ɹ/, but only their first consonant is the target. An actual /f/ realization of the intended /θ/ category would collapse this exercise; excluding that take would enforce the selected reference target, not declare another English variety incorrect. “Fin” is the fish-organ word, not the separate French loanword entry /fɛ̃/. These pronunciation questions are repeated in the audio request.

The proposed soot/suit pair was rejected: [the American soot entry](https://www.collinsdictionary.com/us/dictionary/english/soot) lists both /sʊt/ and /sut/, while [suit](https://www.collinsdictionary.com/us/dictionary/english/suit) has /sut/. One accepted soot variant therefore erases the contrast. A word’s familiar spelling does not establish the required category.

Each contrast has only three pairs. Cross-word ABX is structurally possible, with two other lexical pairs available for X, but this is still a small vocabulary pool. Repeated tokens can be memorized. Audio engineering, dictionary agreement, or successful playback would not establish pronunciation quality, stable speaker identity, transfer to unseen words or learning efficacy.

## Files and validation

- `candidates.json`: four contrast objects compatible with the current curriculum shape, inside an isolated wrapper. Text is editor-curated; audio is pending listening review.
- `source-audit.json`: 24 exact American transcriptions, entry/sense disambiguation, normalization, restrictions and rejected soot/suit evidence.
- `selection-evidence.json`: authoritative inventory slice, legacy topic mapping, source hashes and the limits of saved GSC evidence.
- `audio-request.json`: all 24 required words and complete two-profile requirements. There are 23 new text words; thin already occurs in the current curriculum. Full collection coverage is **48 clips**; 46 refers only to the 23 new words × two profiles. No recording is approved here, and existing thin does not establish reusable matched-profile coverage.
- `validation.json`: 12/12 pairs pass the one-token substitution, category orientation, declared dictionary-to-IPA and cross-word pool checks. All 24 word records match the source audit and audio request. Five negative mutations are rejected: swapped categories, a second changed phoneme, conflicting dictionary IPA, a missing requested word and an invented audio approval.
- `build_candidates.py`: reproduces only this folder’s candidate documents from the explicit editorial data; it reads the current inventory to capture selection provenance.
- `audit.py`: offline validation of this folder. It does not request network access or validate audio. Run `python3 rescue/content/english-legacy-batch2/audit.py` from the repository root.

The structural check is separate from the manual dictionary reading. This audit changed no main curriculum, published manifest, Google audition allowlist, budget ledger or live service, and generated no audio. The Google audition remains its previously approved bounded selection; this request does not extend that authorization or spend cap.

Integration can restore the four routes’ text after review of these mappings. Usable audio requires complete matched profiles and a separate listening decision for the exact takes. Do not market this batch as reviewed audio merely because the text audit passes. Revenue projections remain unchanged until actual reach, exercise use and conversion supply new evidence.
