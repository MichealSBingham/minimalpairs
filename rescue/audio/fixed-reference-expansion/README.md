# Isolated fixed-reference expansion

Completed 28 September 2026: **46 primary candidates, 957,704 bytes**. No public app or curriculum changed. Generation is frozen; every file is synthetic and `generated-unreviewed`.

Two accepted fictional profiles cover all 17 requested English words for `en-zh-j`, `en-foot-strut`, `en-ae-strut`. Two accepted fictional French profiles cover chat/chant, rat/rang, plat/plan for isolated candidate `fr-a-an`. English luck occurs in two contrasts, so it is stored once per profile.

The independent audit passed all 46 source/output hashes, decoding, format, bounded generation, exact coverage and fixed-conditioning checks. It found no engineering errors or duration warnings. **This is not phonetic or audible-speaker validation.** Exact listening questions and source citations are in [the focused report](../../../research/fixed-reference-expansion-2026-09-28.md).

## Handoff

- `manifest.preview.json`: public-safe 46-clip metadata.
- `manifest.complete-scopes.preview.json`: explicitly scoped 46-clip variant. All four scopes now have full file coverage; none is approved for assessment.
- `integration-inventory.json`: exact selected files, hashes, sizes and URLs. No automatic publication.
- `reference-provenance.public.json`: fictional anchor identities/hashes, supplied transcripts and original generation metadata, with private paths removed.
- `clips/`: the 46 primary MP3s. Never copy the entire experiment directory into the public app.
- `verification.json`, `provenance.json` and `provenance/`: fresh engineering results and pinned license/runtime/weight evidence.
- `run-summary.json`, `repair-lesion-result.json`: cumulative attempts and bounded repair.
- `listening-review.template.json`: unfilled review sheet. Check pronunciation separately from naturalness and speaker identity.

Do not publish `private/`, raw anchors, original WAVs, rejected material, `inventory.private.json` or `manifest.candidate.json`. No real person's voice was cloned. No new model download, paid API call or correspondence was used.

## Failure retained and one bounded repair

Initial generation produced 45/46. English B `lesion` returned immediate EOS on three seeds; B `cap` first returned near-silence and passed the second engineering attempt. The initial failed verification and manifests remain in `private/pre-lesion-punctuation-repair/`.

One separate input-conditioning experiment, authorized by root and capped at two attempts, changed only the English B input from `lesion` to `Lesion.` while retaining the exact same reference. The first attempt produced 0.96 seconds. The actual changed input, unique cache key, seed 2320000 and unchanged reference hashes are recorded; no speech crop or different word was substituted. The spoken content still requires listening. The new repair script refuses further attempts once its result exists.

Combined measured generation invocations lasted 62.72 seconds. There were 50 calls, 46 accepted and four rejected. Duration range is 0.40–1.92 seconds. These descriptive counts do not measure model phonetic accuracy.

## Reproducibility

Run only inspection/packaging now; generation is frozen:

```sh
rescue/audio/.venv/bin/python rescue/audio/fixed-reference-expansion/verify.py
rescue/audio/.venv/bin/python rescue/audio/fixed-reference-expansion/finalize.py
```

`generate.py` and `repair_lesion.py` default to dry runs and retain original input settings. Model and runtime sources are pinned/hash-recorded; numerical identity across different hardware or package versions is not promised. The local runtime's Base ICL path uses reference speech codes, speaker embedding and supplied reference text, and internally removes its decoded reference prefix. IPA is review metadata, not a synthesis control.

Priority listening holds are version/virgin's shared /ən/, French rat /a/, B cap clipping, repaired B lesion, every isolated word's exact phonemes, and same-profile identity across words. A fixed conditioning waveform does not prove a stable perceived speaker or native accent. One primary token per word also leaves memorization and artifact confounds for repeated practice.
