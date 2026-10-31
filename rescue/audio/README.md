# MinimalPairs cached audio

Generate the curriculum once and serve static audio. No model or API key ships to the browser; no generation charge occurs when a learner replays a clip.

## Production candidate and preview

Google Cloud Chirp 3 HD is the initial production candidate: many named voices in all eight languages, an ongoing free character quota, and a documented application use case. Account billing must be enabled even within the free quota. Aoede and Charon are **candidate** profiles, not quality-ranked or pronunciation-approved voices.

Qwen3-TTS VoiceDesign is the account-free local preview route on this Apple-silicon Mac. We downloaded the Apache-2.0 4-bit MLX conversion, pinned to `5c390979e4b93af5f2932f90742ca99c7dd04687`. Voice prompts request native accents, but prompts do not establish native accuracy or stable speaker identity across clips. It is synthesized speech, not a human recording.

## Plan without network calls or spending

```sh
python3 rescue/audio/audio_cache.py rescue/content/curriculum.json
python3 rescue/audio/audio_cache.py rescue/audio/probe-items.json --provider google
```

The dry run reports unique words, expanded voice clips, cached count, characters to generate, and an upper-bound list-price illustration if no free quota remains. Defaults: two voices, 100,000-character ceiling per invocation, no synthesis unless `--execute` is passed. Monthly quota is shared with other usage in the account, so the script does not assume quota availability.

## Generate with Google

Supply one of `GOOGLE_TTS_API_KEY`, `GOOGLE_OAUTH_ACCESS_TOKEN`, or configured `gcloud` application-default credentials in the environment. Optionally set `GOOGLE_CLOUD_PROJECT` as the quota project. Keep credentials in the operator environment; never store them in the application/public folder or put them in a command-line argument.

```sh
python3 rescue/audio/audio_cache.py --list-google-voices
python3 rescue/audio/audio_cache.py rescue/audio/probe-items.json --provider google --execute
```

The script checks the live provider catalog before using voice IDs. It creates MP3 files plus a manifest consumed by the frontend. Use `--language fr --limit 2` for a two-word probe. `--voices a` generates just one profile. Set a lower `--max-characters` limit for tightly bounded experiments. A Google monthly quota budget alert is not a hard spending cap; use the script cap and provider quotas too.

## Generate locally on Apple silicon

```sh
/opt/homebrew/bin/python3.12 -m venv rescue/audio/.venv
rescue/audio/.venv/bin/pip install -r rescue/audio/requirements-local.txt
rescue/audio/.venv/bin/python rescue/audio/audio_cache.py rescue/audio/probe-items.json --provider qwen --execute
```

Initial model download: approximately 2.31 GB; subsequent runs reuse the local Hugging Face cache. Local synthesis needs compute/electricity, but no API subscription. `ffmpeg` is required for MP3 encoding. Model/runtime files are outside the deployed website. These voice instructions do not clone a real person's identity.

## Data interface

Input can be `{items:[{languageId,text,ttsText?}]}` or the curriculum format `{languages:[{id,contrasts:[{id,pairs:[{id,words:[{text,ttsText?},...]}]}]}]}`. `text` is the displayed word; `ttsText` is an explicit pronunciation input override. Stress/romanization should not be fed to TTS automatically.

Output defaults to `rescue/app/public/audio/manifest.json`:

```json
{
  "schemaVersion": 1,
  "voicesByLanguage": {"fr": [{"id":"qwen-fr-a","name":"Voice A","description":"..."}]},
  "clips": [{"id":"hash","languageId":"fr","text":"tout","voiceId":"qwen-fr-a","url":"/audio/clips/hash.mp3","status":"generated-unreviewed","provider":"qwen","synthetic":true}]
}
```

Provider, version, locale, voice description, text and generation settings determine the cache key. The manifest includes a SHA-256 of the encoded file. Regeneration changes the path when inputs change; a retry reuses the cache. A local lock serializes generation writers to protect manifest entries.

## Release gate

Generated does not mean reviewed. The website may expose these samples as a clearly labelled preview for owner validation, but should not label them native-reviewed or use them as a certified pronunciation answer key.

For each contrast, listen to both words in each voice in randomized order. Confirm word identity, the target phoneme/tone, intended dialect, no added words, no truncation, ordinary speech quality and consistency. Recheck after changing provider/model/text. Use multiple lexical examples and hold out a voice or word for transfer tests. Do not let a voice identify the answer: both sides of a pair must have the same set of available voices.

The agent verified file generation and playback-compatible encoding, **not auditory correctness**. Its current tool channel does not support hearing these audio files. The owner or a competent language reviewer must supply that evidence; automatic transcripts are not a replacement for phonetic listening.

## Starter curriculum coverage and recovery

Verified 28 September 2026: the full starter curriculum has **93 pairs and 175 unique language/word combinations across eight languages**. All **350 required clips**, two synthetic voice profiles per word, are cached, totaling **3,544,264 bytes**. Repeated words within a language reuse their recordings.

The root operator completed generation and bounded repair, then ran `verify_coverage.py --decode`. The saved `coverage-report.json` reports zero missing clips, duplicate entries, invalid files, IPA-metadata mismatches or duration flags, with decoding checked and engineering coverage complete. **All 350 clips remain `generated-unreviewed`; `phoneticListeningVerified` is false.** These results establish file coverage and integrity, not pronunciation accuracy or human listening approval.

```sh
rescue/audio/.venv/bin/python rescue/audio/audio_cache.py rescue/content/curriculum.json --provider qwen --execute
rescue/audio/.venv/bin/python rescue/audio/repair_candidates.py
python3 rescue/audio/verify_coverage.py --decode
```

The Qwen batch exposed some runaway outputs for isolated words. The repair command quarantines clips longer than a conservative three-second word cap or reaching the generation token cap, attempts up to four alternative seeds, and records both the rejected candidates and the selected seed. It does not trim a runaway recording into an apparently valid word. Failed candidates remain outside the public directory. `generation-overrides.json` makes a later cache run reproduce the selected request key.

`coverage-report.json` checks both words in every pair for both voices, duplicate entries, target-IPA metadata, file checksums and optional decoding. Its `complete` field means engineering coverage only; `phoneticListeningVerified` remains false.

`pronunciation-overrides.json` records the one current lexical disambiguation: Mandarin 雨 is the noun *yǔ*, rain, not an alternative fourth-tone reading. The exact added instruction is retained in the clip manifest. Spanish accents and Russian ё/ь are preserved. Russian multisyllabic starter words all intend initial stress; no new stress mark or carrier sentence has been silently added to their spoken text. All these intentions still require listening confirmation.
