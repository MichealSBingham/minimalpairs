# Fixed synthetic reference pilot

Completed 28 September 2026. **Private candidate; generated and unreviewed. No public application audio was changed.**

The experiment produced four fictional reference voices and 72 word takes: two profiles × six words × three takes in each language. The English scope is `ship/sheep`, `fill/feel`, `sit/seat`; French is `tout/tu`, `vous/vu`, `roue/rue`. These are three existing lexical pairs per contrast, sufficient for the current cross-word trial structure. This does not supply the additional pending English contrasts.

## Ready handoff

- `manifest.preview.json`: public-safe candidate metadata, **take 0 only**, 24 unique `(language, word, voice)` mappings. Intended URLs are `/audio/fixed-speaker-pilot/clips/<id>.mp3`. This script has not copied them into the public app.
- `primary-files.json`: the exact 24 local clip paths, URLs and hashes to copy for a separate comparison. Total primary MP3 size is **513,696 bytes**.
- `references.public-metadata.json`: supplied reference texts, hashes, instructions, intended dialects and generation metadata, with raw reference paths removed.
- `manifest.candidate.json`: full local metadata for those same 24 primary mappings, including private provenance paths.
- `take-inventory.json`: all 72 candidate takes. Distinct hashes: **72**. Total encoded size: **1,546,368 bytes**.
- `verification.json`: independent coverage/hash/decode/length checks and the retained review warnings.
- `provenance.json` and `provenance/`: pinned model cards/configs, model weight hashes, runtime versions/source hashes and licensing evidence.
- `listening-review.template.json` and `review.html`: neutral, unfilled local review worksheet. The HTML deliberately uses private reference paths and **must not be published**. It permits listening and downloading notes; it does not approve any audio.

Publish only the explicitly selected primary MP3s and public-safe metadata when staging the separate owner comparison. Do not publish `private/`, raw reference WAVs, rejected/retired assets, or the local listening page. Each clip remains `synthetic:true`, `status:"generated-unreviewed"`, `phoneticListeningVerified:false`, `speakerConsistencyVerified:false`.

## What changed technically

The old per-word VoiceDesign method repeated a verbal description independently. This pilot first creates one original fictional reference per profile, then uses the **same cached waveform and supplied transcript for every word and take** through Qwen Base's reference-conditioning path. The Base model has a speaker encoder and audio encoder; the runtime uses a reference speaker embedding, reference speech codes and the reference text. All four accepted reference waveform hashes and four speaker-conditioning embedding hashes differ. Each profile's inputs remain identical across its outputs.

That establishes fixed conditioning inputs. It does **not** establish stable audible identity, correct vowel realization, a native accent, naturalness or learning effectiveness. The stored transcript is the exact text supplied to synthesis; it has not been confirmed by listening. No real person's recording was used as a cloning reference, including the Commons contributors from other pilots.

Qwen documents the [VoiceDesign → Base reference workflow](https://github.com/QwenLM/Qwen3-TTS#voice-design-then-clone). The locally inspected [MLX implementation](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/tts/models/qwen3_tts/qwen3_tts.py) performs the conditioning and internally removes the decoded reference prefix proportionally. Our pipeline adds no posthoc word trimming, denoising, time stretching or phoneme editing. It applies only a conservative peak scale when needed, writes PCM16 originals, then encodes mono 192 kb/s MP3 at the original 24 kHz rate. Scale factors are recorded per asset.

## Models, cost and reproducibility

| Purpose | Pinned model revision | License shown in pinned card |
|---|---|---|
| Fictional reference design | `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit` at `5c390979e4b93af5f2932f90742ca99c7dd04687` | Apache-2.0 |
| Fixed reference synthesis | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit` at `0d6bb6fe33f92d47a507e23b9148940e8366ab5b` | Apache-2.0 |

The existing design model was reused; the additional Base download was approximately **1.71 GB**. There were no API charges or paid services. Disk, local compute and review effort remain costs. These model license labels are not a claim that outputs are human recordings or CC-licensed. [Pinned Base model card](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit/blob/0d6bb6fe33f92d47a507e23b9148940e8366ab5b/README.md), [pinned VoiceDesign model card](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit/blob/5c390979e4b93af5f2932f90742ca99c7dd04687/README.md).

Runtime: `mlx-audio 0.5.7`, `mlx 0.32.2`. Per-asset records include model revision, exact text, reference/transcript/embedding hashes, seed, temperature, top-p, token cap, elapsed generation time, source/output hashes and encoding. Additional effective defaults are recorded in `provenance.json`. Inputs and seeds aid reproduction; byte-identical output on different runtime/hardware is not promised.

Accepted final word generation took **0.69–1.65 seconds per take**, median **0.98 seconds**, totaling **72.57 seconds of measured accepted word-generation calls**. This excludes reference generation, failed attempts, model loading, encoding and investigation time. The final repair invocation lasted 25.32 seconds; `run-summary.json` describes that last invocation, not total experiment duration. The full timestamped attempt log remains private.

## Failures and retained warnings

The initial 12.56-second English A reference was technically valid audio but unreliable conditioning for isolated words: only 4 of its intended 18 takes succeeded, with repeated immediate end-of-sequence responses for the remainder. The first run stopped on an empty response; the bounded retry path then logged such responses explicitly. The **entire profile** was retired, with its four outputs and original reference retained under `private/retired-en-a-long-reference/`. It was not mixed with the replacement profile.

One shorter 6.24-second fictional English A reference then produced all 18 required takes on their first attempts. The other accepted references are English B 13.68 s, French A 10.24 s and French B 8.64 s. This is evidence of recovery for this small batch, not evidence that shorter references are generally better.

The independent verifier found **zero hard engineering errors**, complete four-profile coverage and 72 distinct decodable outputs. It retained **three listening warnings**:

1. French A `vu`, alternate take 2 (zero-based), is unusually long at 2.862 s. It is **not** the primary take.
2. English B `sit` varies from 0.48 to 1.28 s across takes (2.67×).
3. French A `vu` varies by 4.00× across takes.

Duration alone cannot identify the spoken content or prove failure. These items need actual listening for extra speech, clipped segments, padding and contrast quality. Do not normalize away genuine phonetic duration cues to conceal variation. The files have not been listened to or approved by this agent.

## Review and expansion gate

Use the separate comparison to judge the anchors' exact text, every primary word's contrast, and same-profile identity across words. Mark pass/fail/uncertain independently from naturalness. Keep failed or uncertain required entries out of any promoted complete contrast. Additional takes can support a later take-aware adapter after review; the primary manifest intentionally avoids duplicate lookup ambiguity.

Technical readiness is limited to this optional, explicitly unreviewed comparison. There is no claim that it surpasses human recordings or the prior generated voices. Do not expand this result automatically to new English lessons or other languages. Fixed reference conditioning does not solve small-pool word memorization, token familiarity, recording artifacts or lack of held-out learning evaluation.

Run from the workspace with the existing local audio environment:

```sh
rescue/audio/.venv/bin/python rescue/audio/fixed-speaker-pilot/run_pilot.py
rescue/audio/.venv/bin/python rescue/audio/fixed-speaker-pilot/run_pilot.py --execute
rescue/audio/.venv/bin/python rescue/audio/fixed-speaker-pilot/verify_pilot.py
rescue/audio/.venv/bin/python rescue/audio/fixed-speaker-pilot/record_provenance.py
rescue/audio/.venv/bin/python rescue/audio/fixed-speaker-pilot/build_review.py
rescue/audio/.venv/bin/python rescue/audio/fixed-speaker-pilot/prepare_preview.py
```

Generation defaults to a dry run. Existing completed references and takes are hash-checked and reused. All scripts write only within this isolated directory; none publishes or replaces app audio.
