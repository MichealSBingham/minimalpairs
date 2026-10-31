# German human audio: two-pair candidate

**Eight clips, 195,319 bytes; two contributors × four exact words.** Scope: in/ihn and im/ihm, short /ɪ/ versus long /iː/. This is an isolated optional candidate, not a replacement for the existing German lessons. No main app, default manifest or curriculum was edited.

- Jeuwre: four files, CC BY-SA 4.0; source declares a native German speaker from Berlin.
- joni: four files, CC BY-SA 3.0 via recorded GFDL migration; native/regional status unestablished.

All clips remain `synthetic:false`, `status:"source-verified-unreviewed"`, with pronunciation and speaker consistency unverified. The independent file/coverage/category audit passed with zero errors. **Two warnings remain:** both contributors' current upload/version dates correlate with vowel category. That is a metadata association, not proof of audible artifacts; the set is not a controlled same-session corpus.

The three-pair search found exact-word gaps in the existing lessons and alternate pairs. Root then authorized this complete two-pair collection. The small four-word pool permits lexical/token memorization and cannot establish learning efficacy or held-out transfer. Exact source/coverage findings and listening questions are in the [focused report](../../../research/human-german-pilot-2026-09-28.md).

## Reviewable handoff

- `manifest.preview.json`: public-safe manifest, collection `human-de-i-length-pronouns-v1`; intended URL prefix `/audio/human-de-i-length/clips/`.
- `curriculum.candidate.json`: isolated `de-i-length-pronouns` contrast; pair IDs `de-in-ihn`, `de-im-ihm`; /ɪ/ category 0, /iː/ category 1.
- `integration-inventory.json`: exact eight selected assets with hashes and per-file license versions.
- `attribution.json`, `ATTRIBUTION.md`: creators, titles, revision/source/license links, retained notices and encoding changes.
- `verification.json`: file, source hash, decode, exact two-profile coverage and phoneme/category checks.
- `source-audit.json`, `source-evidence-index.json`, `recording-conditions-audit.json`: source evidence, gaps and limitations.
- `listening-review.template.json`: unfilled checks for each word and pair; no listening approval.

Publish only explicitly selected clips and public-safe metadata when a separate preview is authorized. Keep `private/`, `manifest.candidate.json`, `acquisition-progress.json` and the raw discovery cache out of the public app. Preserve each file's ShareAlike version and attribution; do not apply restrictive DRM to these assets. No blanket license change is made.

Original Vorbis files remain private and hash-matched to Commons metadata. The derived files are mono 44.1 kHz, 192 kb/s MP3; no speech trimming, pitch/time changes, denoising or loudness normalization was performed. Hashes/decoding do not establish correct speech or consistent speakers.

To inspect or reproduce packaging with existing cached evidence:

```sh
python3 rescue/audio/human-german-pilot/package.py
rescue/audio/.venv/bin/python rescue/audio/human-german-pilot/verify.py
```

The acquisition script reuses hash-checked originals and refuses network requests during any recorded Wikimedia cooldown. There were no rate-limit responses during this pilot. No paid API, model generation, human voice cloning or correspondence was used.
