# English human-recording candidate

This isolated candidate targets all three existing `en-i-ih` pairs: **ship/sheep, fill/feel, sit/seat**. The two credited recording profiles are **Grendelkhan** and **Dvortygirl**. No curriculum change or substitute word is needed. No public application files are changed by these tools.

**Completed 2026-09-28:** all **12 clips**, **218,687 encoded bytes** (465,130 original bytes). Independent verification passed exact word/profile coverage, unique hashes, source/output checksums, common 44.1 kHz mono output and decoding for every file. MP3 durations span 0.604–0.850 seconds. Listening review is still pending.

The candidate is suitable for an explicitly labeled listening-review preview, not a claim that the recordings are acoustically approved or match General American pronunciation. Every clip is `synthetic:false`, `status:"source-verified-unreviewed"` and `phoneticListeningVerified:false`.

## Ready-artifact contract

- `manifest.candidate.json` is written only after all twelve source files pass the acquisition checks. It uses the app's `voicesByLanguage` / `clips` shape and lists the three current pair IDs.
- `clips/` contains the complete candidate MP3s. Manifest URLs target `/audio/human-en-i-ih/clips/<hash>.mp3` but are not deployed by this task.
- `verification.json` records acquisition, decoding, coverage and encoding status. It is not pronunciation evidence.
- `ATTRIBUTION.md` and `attribution.json` contain per-file credits, source and audited-revision links, license choices and encoding changes.
- `listening-review.template.json` has twelve pending entries. Do not mark one reviewed without listening to the whole recording.
- `sources/` retains the bounded search responses, exact file metadata and revisions, MediaInfo statements, original-upload provenance, and public native-language declarations.
- `private/originals/` retains byte-for-byte source files, excluded from Git. `private/retired-encoding-v1/` retains the preliminary encoding attempt outside the candidate directory.

## Word and speaker provenance

Grendelkhan's six Lingua Libre files have explicit English word transcriptions in Commons MediaInfo property `P9533`, distinct from their filenames. The rendered source credits name Grendelkhan as speaker and recorder and identify Lingua Libre speaker `Q929501`. Each exact file page carries `{{cc-zero}}`. The [Commons profile](https://commons.wikimedia.org/wiki/User:Grendelkhan) publicly declares native English. Regional accent is not established; do not relabel the profile General American from an assumption about geography.

Dvortygirl's six exact file pages identify US English and own recordings. For `ship`, `sheep`, `feel`, `sit` and `seat`, the captured original upload description names the term in its pronunciation category and explicitly identifies Dvortygirl as recorder. The upload's source hash matches the current original. `fill` has an explicit full-word description in the file page and an embedded original `TITLE=fill`. This establishes source word identification beyond filenames, not an independent auditory transcription. The [Commons profile](https://commons.wikimedia.org/wiki/User:Dvortygirl) declares native English. Actual accent and same-speaker consistency still require listening review.

The original `fill` Ogg contains an additional artist credit. Both that credit and the Commons account credit are preserved in attribution; no alias or identity relationship is independently asserted. Other embedded personal fields unrelated to attribution or language teaching are omitted from the manifest.

## Per-file commercial reuse

Grendelkhan's files remain [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), with voluntary provenance credit. Dvortygirl's files explicitly offer [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) among multiple licenses; this candidate selects that license consistently for all six. The [3.0 legal code](https://creativecommons.org/licenses/by-sa/3.0/legalcode) permits distribution and performance subject to its attribution, notice and share-alike conditions. Retain the original titles, named creators, source/license links and conversion notice when integrating. Do not imply contributor endorsement or add restrictions to the licensed recordings. Neighboring CC0 recordings do not become BY-SA.

The `fill` source embeds a nonstandard `Creative Commons BY-CA` string. It is retained as an original notice, while the selected distribution license is the explicit CC BY-SA 3.0 offer on that exact current Commons page. License evidence is recorded per file; a general Commons site footer is never treated as the audio license.

## Encoding and verification

```sh
python3 rescue/audio/human-english-pilot/discover.py
python3 rescue/audio/human-english-pilot/acquire.py
python3 rescue/audio/human-english-pilot/verify_pilot.py
python3 rescue/audio/human-english-pilot/build_audit.py
```

All outputs use **192 kbps, 44.1 kHz mono MP3**. The source recordings have different sample rates/channel counts; notably `fill` is an unusual 44,000 Hz Ogg, which MP3 cannot preserve exactly. An initial preserve-format check stopped rather than silently misreporting it. The final candidate explicitly records source-to-output resampling and downmix. Original files are retained unchanged. No trimming, denoising, time stretching, pitch shifting or loudness normalization is applied. Downmix may change channel balance. Encoder padding can add less than 0.1 seconds to container duration.

Checks cover original file size and Commons SHA-1, original/output SHA-256, exact word-by-profile coverage, distinct source/output hashes, decoding, common output sample rate/channels, and duration. These checks cannot establish vowel quality, naturalness, speaker consistency, lack of added speech or instructional suitability. Listen before making those claims.

The media downloader uses the official asset host, spaces successful requests and stops on HTTP 429, recording and respecting `Retry-After`. It also honors a pending media cooldown from the French pilot. It never changes host or user agent to evade a restriction.

## Bounded search and exclusions

Six exact-word Lingua Libre searches each retrieved all reported hits within a 100-result cap. Grendelkhan and Nattes à chat had filename coverage for all six words; Wodencafe had five, lacking `sheep`; Back ache had four. One additional Wodencafe/sheep search found no result. Six existing US-English Ogg source titles provided the Dvortygirl candidate. No further crawling or word substitutions were necessary.

Grendelkhan and Dvortygirl were selected because the metadata provides full current-word coverage and public native-English declarations. Other contributors were not acoustically judged or deemed unsuitable. Neither selected profile is independently identity-verified, and neither has completed the pilot's listening review.
