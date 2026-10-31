# Human English expansion candidate

**Acquired and engineering-checked: 12 recordings, two credited contributors, all three TRAP/STRUT pairs.**

Encoded bytes: 213,044. Independent checks: 0 hard errors, 0 engineering warnings; twelve distinct file hashes. Durations 0.522–1.000 seconds.

Scope: **cat/cut, cap/cup, lack/luck**. Contributors: Grendelkhan (CC0) and Dvortygirl (CC BY-SA 3.0). Each source’s license and attribution stays separate. Only Dvortygirl has explicit US/GA source evidence; Grendelkhan’s regional accent is unestablished. All audio is **source-verified-unreviewed**, not pronunciation-approved.

The /ʒ–dʒ/ and /ʊ–ʌ/ requests remain incomplete. The conflicting source pronunciation of virgin, absent pledger, unmatched contributor coverage and phrase-only US putt alternative are documented in `source-coverage-audit.json` and the [focused report](../../../research/human-english-expansion-2026-09-28.md).

`manifest.candidate.json` and `attribution.json` are produced only upon complete acquisition. `verification.json` records independent engineering checks. `listening-review.template.json` contains no prefilled approval. `private/originals/` preserves originals; `sources/` preserves research snapshots. Neither should be copied into the public app. MP3s are in `clips/`. No app or default manifest is changed.

The source file size/SHA-1 and output SHA-256 are checked. Output: 44.1 kHz mono 192 kb/s MP3, resampling/downmix where needed, metadata stripped; no trimming, denoising, pitch/time alteration or loudness normalization. Encoding does not validate the phonetics or eliminate source-session differences.

From the workspace, use the existing audio environment:

```sh
rescue/audio/.venv/bin/python rescue/audio/human-english-expansion/discover.py
rescue/audio/.venv/bin/python rescue/audio/human-english-expansion/acquire.py
rescue/audio/.venv/bin/python rescue/audio/human-english-expansion/verify.py
rescue/audio/.venv/bin/python rescue/audio/human-english-expansion/audit_sources.py
rescue/audio/.venv/bin/python rescue/audio/human-english-expansion/write_report.py
```

Downloads resume from checked originals. Any Wikimedia Retry-After stops requests; the deadline is recorded in `private/retry-not-before.json` and honored across the audio research directories. No alternate host is used to bypass it.
