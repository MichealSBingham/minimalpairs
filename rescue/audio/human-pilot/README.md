# French human-recording comparison pilot

This is a separate candidate for three existing French /u–y/ pairs: **tout/tu, vous/vu and roue/rue**. Both credited speakers, **Poslovitch** and **Sartus85**, have an exact isolated-word source record for all six words. The fourth full-lesson pair, **bout/bu**, is excluded because a matching `bu` recording was not found for either speaker. The full synthetic lesson is unchanged.

The candidate is intended for an explicitly named optional comparison page. It must not replace the complete lesson or silently fall back to another speaker, synthetic audio, a different word or an extracted phrase.

**Acquisition completed on 2026-09-28:** 12 MP3 files, two credited speakers, three complete matched pairs, **238,784 bytes**. The independent verifier confirmed exact six-word coverage per speaker, all source and output hashes, successful decoding and the separate licenses. The complete `manifest.candidate.json` and `verification.json` are present. This is source and engineering verification; all listening-review entries remain pending.

## Files and integration contract

- `manifest.candidate.json`: written only after all 12 recordings have been acquired and verified. It follows the application's `voicesByLanguage`/`clips` shape and restricts eligible pairs to `fr-tout-tu`, `fr-vous-vu`, `fr-roue-rue`.
- `clips/`: completed candidate MP3s. Target manifest URLs are `/audio/human-fr-u-y/clips/<hash>.mp3`.
- `verification.json`: final acquisition/decoding/coverage status. Absence means acquisition has not completed.
- `ATTRIBUTION.md` and `attribution.json`: all source, creator, license and conversion notices for publication beside the optional pilot.
- `sources/`: captured Commons API results, exact file-description revisions, structured transcription evidence and the public language declaration used in this audit.
- `private/originals/`: byte-for-byte source WAVs, Git-ignored and retained for review/reprocessing. Provisional rejected Shtooka files are also kept privately.

Every final clip has `synthetic:false`, `status:"source-verified-unreviewed"` and `phoneticListeningVerified:false`. The status means source, transcription metadata and license evidence were checked. It does **not** mean the agent listened to or approved the pronunciation.

## Source and license audit

Sartus85's exact file pages contain a Lingua Libre record with speaker ID `Q1422544`, French language ID `Q150`, and the literal target transcription. Each page carries `cc-by-sa-4.0`; each MP3 retains [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Preserve attribution, source links, license and the conversion notice. The [legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en) permits technical format changes and specifies attribution and share-alike conditions.

Poslovitch's exact file pages carry `cc-zero`; Commons MediaInfo property `P9533` supplies the exact French transcription for each file. Speaker ID `Q142683` is consistent across the rendered credits. Each MP3 remains [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The neighboring BY-SA files do not relicense the CC0 files. Attribution is retained voluntarily for provenance.

The public [Poslovitch profile](https://commons.wikimedia.org/wiki/User:Poslovitch) declares native French. Regional accent is not established. Sartus85's source pages establish French and the credited speaker, but neither native-language status nor regional accent was independently established. Archived Lingua Libre speaker entities could not be retrieved. Do not describe either profile as an independently validated Metropolitan French voice.

## Rejected source and coverage gaps

An initial Nicolas Vion/Shtooka candidate appeared to cover `tout/tu` and `roue/rue`. The original Ogg metadata identifies `SWAC_TEXT="une roue"` for the file titled `Fr-roue.ogg`. Its explicit speaker field identifies Vion Nicolas, but the declared spoken phrase does not match an isolated-word trial. The profile was excluded from this pilot before manifest completion. The recording was not cropped or relabeled.

Commons exact-file and broader author/category searches found no isolated `vu` or `bu` by Nicolas Vion and no isolated `bu` by Poslovitch or Sartus85. Search coverage is evidence of the bounded search, not proof that recordings exist nowhere. Only one searched Lingua Libre speaker had an exact lowercase `bu` entry; switching speakers for that one word would defeat matched coverage, so it was not used.

## Acquisition and verification

```sh
python3 rescue/audio/human-pilot/acquire.py
python3 rescue/audio/human-pilot/verify_pilot.py
python3 rescue/audio/human-pilot/build_audit.py
```

The acquisition command checks exact-file license templates, speaker attribution, literal source transcription, original file byte count and Commons SHA-1. It stores private originals, converts to 192 kbps MP3, verifies decoding and checks that source sample rate/channel count and full timing are retained within encoder-padding tolerance. It does not trim, denoise, stretch, pitch-shift or normalize loudness. Source and output SHA-256 hashes are retained.

The media server briefly rate-limited acquisition. Its ten-minute cooldown was respected; the remaining files were acquired after 19:15:17 UTC. The script honors `Retry-After`, records a private not-before timestamp for longer cooldowns, and resumes from verified local files. Do not bypass a cooldown or integrate a partial set.

The separate `rescue/app/tests/audio-source.test.mjs` suite passed all 12 tests against the app's optional-manifest adapter. It checks source/review labels, strict errors for missing words or voices, media failures, no human-to-generated/device substitution, and compatibility with the default audio collection. These are behavior tests using mocked browser boundaries, not listening tests.

No public application audio has been replaced by this acquisition task. Before claiming reviewed pronunciation, someone must actually listen to all twelve files in randomized order and confirm the words, /u–y/ contrast, accent compatibility, ordinary delivery and absence of added speech. Metadata, checksums and automatic transcription are not substitutes for that evidence.
