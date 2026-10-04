# French /u–y/: additional practice vocabulary

Reviewed 2026-09-30. **Six strict minimal pairs, 12 distinct words, two separate three-pair sets. Text candidate only; zero approved recordings.** This directory is isolated from the app, public curriculum and assessment material.

| Set | Selected pronunciation | Post-answer meanings |
| --- | --- | --- |
| Final vowel | dessous /dəsu/ – dessus /dəsy/ | underneath – on top |
| Final vowel | égout /eɡu/ – aigu /eɡy/ | sewer – sharp/pointed |
| Final vowel | écrou /ekʁu/ – écru /ekʁy/ | fastening nut – unbleached cloth |
| First vowel | bouche /buʃ/ – bûche /byʃ/ | mouth – firewood log |
| First vowel | joute /ʒut/ – jute /ʒyt/ | contest/verbal sparring – textile fibre |
| First vowel | bouleau /bulo/ – bulot /bylo/ | birch tree – whelk |

The first set says to listen to the vowel at the end. The second says to listen to the first vowel after the initial consonant. Bouleau/bulot have another vowel, /o/, which must remain the same. Do not flatten these sets into a single group or reuse the final-vowel instruction for the second set.

The selected dessous/dessus recordings must both retain schwa; the dictionaries also allow its omission, but a mismatch within a pair adds another difference. Aigu must begin /eɡ/, matching égout; its documented /ɛɡ/ alternative is valid French but unsuitable for this selected pair. Use matching broad /ekʁ/ in écrou/écru. Review all exact takes, including final consonants, natural duration and any added final schwa. Bûche's circumflex is not an instruction to exaggerate vowel length.

Source facts and short authored meanings are in `source-audit.json`; the full independent review and primary links are in `research/french-uy-depth-candidate-2026-09-30.md` at the repository root. No dictionary recordings were acquired. The glosses do not imply that every word is beginner-frequency vocabulary.

Validation clears **278 current/candidate English/French spellings, 134 French sound forms, 12 reserved assessment spellings across all languages and six reserved French sound forms**. All ten training inputs, the reserved assessment input and the paid-program brief match their recorded hashes. Exposure means these checked local inventories, not everything a learner has ever heard.

`audit.py` checks six one-phoneme substitutions, 24 eligible reference-pair/X-word/category combinations, 21 rejecting mutations and three extraction fixtures. `verify-engine.mjs` imports the actual app engine without changing its data: 150 sessions/1,800 questions, 96 forced answer/category/profile mappings and four rejecting controls pass. Hypothetical profile identifiers in that test are not evidence of available audio.

**Mixed revisit is not ready:** the engine preserves the trial groups, but current Trainer instructions are contrast-wide; its optional initial/final override is worded for consonants. A future mixed revisit needs per-reference-set vowel focus. The two sets can be considered separately for later integration after audio review.

`audio-request.json` specifies **24 clips: 12 words × two complete, licensed fr-FR profiles**. A/B share a profile; X uses the other profile and a different lexical pair in the same set. This is an inventory and review specification, not generation authorization or an audio approval.

Run from the repository root:

```sh
python3 rescue/content/french-uy-depth-candidate/audit.py
node rescue/content/french-uy-depth-candidate/verify-engine.mjs
```

`build_candidate.py` reconstructs the authored files and captures input hashes. Rebuild only after reviewing changed inputs; it is not a substitute for resolving an audit's baseline-change warning. Future training candidate locations must enter `training_paths()` before claiming complete exclusions.

The public four-pair starter remains unchanged. This is additional within-program practice material, not a held-out assessment, transfer result, completed paid feature, second content release or proof of recurring purchase value. Release and sale flags remain false.
