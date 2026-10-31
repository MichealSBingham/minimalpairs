# Existing English audio: owner-validation handoff

Prepared 28 September 2026 local time. **34 existing synthetic clips, 687,896 bytes; no generation or publication.** Three complete scopes: `en-zh-j`, `en-foot-strut`, `en-ae-strut`, three exact current pairs each, two fictional reference-conditioned profiles. Luck is shared, so 36 scope mappings require 34 files.

- `manifest.preview.json`: sanitized English-only manifest; collection ID `owner-fixed-reference-english-v1`. Copy as a separate manifest; never merge into the default audio library.
- `integration-inventory.json`: exact 34-file copy allowlist, hashes, URLs, scope and integration requirements. Existing clip URLs remain `/audio/fixed-reference-expansion/clips/<id>.mp3`.
- `references.public.json`: synthetic reference provenance and supplied text, with no anchor audio or private paths. The text is not a listening-confirmed transcript.
- `verification.json`: fresh hash/cache/decoder/current-curriculum/reserved-pool receipt. Local engineering evidence, not a public listening approval.
- `audit_delivery.py`: offline audit and metadata packaging only. It writes inside this handoff directory; it never imports generation code or calls a service.

The separate preview must say **synthetic audio, pronunciation/accent/speaker consistency unreviewed**. Preserve the version/virgin shared-schwa condition, repaired B lesion (`Lesion.`), B cap clipping question, and fixed-reference/one-token limitations. Keep its progress source separate, with no device/default fallback or profile mixing. A descriptive “owner preview” label does not itself implement access control.

Copy only the listed MP3s and sanitized preview metadata. Do not copy anchors, raw WAVs, rejected takes, private manifests, source snapshots, French clips or the entire source directory. Source artifacts remain unchanged. No default-library or assessment promotion is approved by this handoff.

Audit command:

```sh
rescue/audio/.venv/bin/python rescue/audio/fixed-reference-expansion/owner-validation-handoff-2026-09-28/audit_delivery.py
```

Focused report: `research/existing-fixed-reference-audio-delivery-2026-09-28.md`.
