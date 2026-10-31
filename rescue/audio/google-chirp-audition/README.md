# Chirp 3 HD audition adapter

**Current status: offline tooling only; owner authorized Google audio with a cumulative $1 generation cap.** The root operator created the isolated project `minimalpairs-audio-20260928` (number `945328995696`), but its billing is not linked/active. The owner also approved Google's separate temporary $50 card authorization, but the attempted authorization failed; the root verified that the new billing account is still closed and asked the owner to correct payment directly in the browser. Latest root readback at `2026-09-29T13:25:24.019Z` still returned `open: false` for the audio billing account; no further card authorization or synthesis was attempted. The original `minimalpairs` project remains billing-disabled. The free trial is unavailable to this owner. This task made no synthesis requests and changed no service or billing setting. See [provider evidence](../../../research/cached-tts-commercial-terms-2026-09-28.md).

This standalone standard-library adapter preserves the existing audio pipeline's `voicesByLanguage` / `clips` interface but never invokes `audio_cache.py`, whose output defaults to the published library. It writes only inside its own ignored `candidate/` folder. There is no `--output`, arbitrary input, custom endpoint, one-word truncation, single-profile option, or automatic fallback.

## Inspect the proposed audition

```sh
python3 rescue/audio/google-chirp-audition/audition.py
python3 rescue/audio/google-chirp-audition/audition.py --languages fr,de
python3 rescue/audio/google-chirp-audition/audition.py --languages all
```

Default is English: two lexical pairs × two words × Aoede/Charon = eight requests. The complete frozen selection contains 16 pairs, 32 words, and 64 clips over all eight languages. Each chosen language keeps both categories and both profiles. `selection.json` retains intended IPA, meaning, pair sources and the captured curriculum hash; it is a subset snapshot, not a claim that the entire live curriculum is covered.

The plan prints every proposed word/voice/locale, cache state, Unicode character count, UTF-8 bytes, list-price estimate with **no assumed free quota**, and a hash. Dry runs read no credentials, make no network calls, and write no files. `--max-characters` can lower the 2,000-character ceiling, never raise it. The code independently fixes the exact permitted pairs/words and a 64-clip maximum. Editing the JSON to add words or alter spoken text is rejected.

The character ceiling applies **per batch**. In addition, a separate durable **cumulative $1 list-price generation ledger** now covers this authorized audition across invocations. It is not an account-wide spending cap on unrelated services or another tool. Every request reserves the conservative UTF-8 byte count × $30/million characters before the POST; no free quota, credits or failed-request refund is assumed. The full 64-clip plan estimates $0.00714 by characters and reserves $0.00846 by the conservative byte bound.

Spanish uses the actual provider locale **es-US**, with the curriculum's **es-MX** target separately retained. Mandarin uses provider `cmn-CN`. All profiles use exact `<locale>-Chirp3-HD-Aoede` or `<locale>-Chirp3-HD-Charon` names. These are synthetic named configurations; they do not establish native pronunciation or invariant acoustic identity.

## Future execution boundary

Execution is pinned to the owner-authorized isolated pay-as-you-go project `minimalpairs-audio-20260928`; production `minimalpairs` and other project IDs are rejected. It requires all of `--execute`, the exact `--project`, a fresh matching `--plan-sha256`, and `--confirm-authorized-paid-project`. The attestation is **not a programmatic billing-readiness check**. Both spending approvals are recorded, but execution remains pending successful payment verification, active linked billing and API readiness, all handled by the root operator. No credential or synthesis request occurred during implementation.

Only after those checks does the adapter read an operator-supplied `GOOGLE_OAUTH_ACCESS_TOKEN`; it does not discover credentials, invoke `gcloud`, or persist tokens. The quota project is explicit and bound into the plan. It uses only Google's fixed HTTPS host, refuses redirects, and verifies all requested exact voice/locale combinations against the live catalog before any synthesis POST. HTTP bodies, tokens and headers are not printed. `ffmpeg` and `ffprobe` must be available before provider requests.

After the root verifies that billing is active/linked and the TTS service enabled, the exact CLI shape is:

```sh
python3 rescue/audio/google-chirp-audition/audition.py --languages all --project minimalpairs-audio-20260928
python3 rescue/audio/google-chirp-audition/audition.py --languages all --project minimalpairs-audio-20260928 --execute --plan-sha256 REVIEWED_PLAN_HASH --confirm-authorized-paid-project
```

Replace `REVIEWED_PLAN_HASH` with the fresh first command's value. The operator supplies the short-lived token only through the child-process environment; do not place it in shell history, a CLI argument, the plan, or a saved file. The safe output root is `/Users/michealbingham/Documents/ChatGPT/MinimalPairs/rescue/audio/google-chirp-audition/candidate/`; the cumulative ledger lives separately under the same tool's ignored `private/` directory. These commands are documentation, not evidence that execution has occurred.

The canonical ignored ledger is `private/budget-ledger.json`, accompanied by `private/budget-initialized.json` and a shared `private/.budget.lock`, all under this tool directory. It is independent of the candidate-store path and bound to the one approved project. Plan hashes include ledger state. Changing candidate paths, clearing clips, restarting or running concurrently cannot silently obtain another allowance; a missing ledger with the initialization marker fails closed. There is no reset/release switch. Manual deletion/tampering with all state is unsupported and is not prevented by a local filesystem ledger.

Before each possibly billable POST, the adapter durably reserves the full upper-bound cost and records a started attempt. It makes exactly one POST attempt per new cache key. Timeout, malformed response, decode failure or interrupted execution blocks the key on the next run; the whole selected batch then stops before any new network activity. An operator must inspect and reconcile that record before considering another request under the existing authorization; its full reservation continues counting against the cap. The script has no automatic retry path. A cache-only rerun reserves zero additional money. The script provides no automatic retry/force-regenerate switch. A request may be billed even if its response is lost. This avoids treating network errors as proof of no charge.

## Cache, output and review

Cache identity includes exact text, provider, REST version, named voice, locale, model family/provider-managed revision label, output format and sample rate. Chirp's model revision is **not immutable**; caching preserves selected bytes but identical future requests may differ. Existing cache files must match saved byte length/SHA-256 and request settings; corrupt/orphaned data blocks regeneration.

The REST payload sends the exact isolated word as plain text, a voice name/language code, and MP3 at 24 kHz. It sends no invented seed, IPA prompt, SSML, pronunciation override, context sentence, rate or pitch instruction. Intended IPA remains review metadata.

Future artifacts, all outside the public app:

- `candidate/clips/<full-request-hash>.mp3`: returned bytes, unchanged.
- `candidate/records/`: request settings, generation date, file hash and codec checks.
- `candidate/attempts/`: no-retry journal, including uncertain outcomes.
- `candidate/manifest.candidate.json`: app-compatible clips/profiles with `generated-unreviewed`, `synthetic:true`, pronunciation/speaker review false, and completed scope inventory.
- `candidate/last-executed-plan.json`, `catalog-selected.json`: bounded batch and exact catalog provenance.

Public-style URLs use a separate `/audio/google-chirp3-hd-audition/` prefix only as a future integration mapping; the tool never copies there. Partial batches retain completed clips but do not mark incomplete scopes complete. Codec checks require mono MP3/24 kHz, full decoding and a finite duration below 15 seconds; durations outside 0.2–3 seconds receive a warning. No waveform is trimmed or corrected. These checks establish playable bytes, not correct speech or contrast suitability.

## Offline tests

```sh
python3 -m unittest discover -s rescue/audio/google-chirp-audition -p 'test_*.py' -v
```

28 offline tests pass. Fixtures use a locally generated sine tone and mocked provider responses. Tests cover exact allowed scope, locale fidelity, changed-input cache identity, cost ceiling, no-network dry run, execution gates, missing voice fail-closed behavior, cached reruns, uncertain-response blocking, interrupted attempts, malformed/non-audio data, cache corruption, output isolation, credential-error sanitization, durable cost reservation before POST, cumulative cap exhaustion, restart/changed-store behavior, cache-zero-cost replay, no silent ledger reset, project pinning, shared-lock concurrency and stale-plan rejection. They make no Google requests and make no pronunciation claims.

## Official API basis

[Synchronous synthesis REST](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize) documents the POST endpoint, request fields, base64 `audioContent` response and Cloud Platform OAuth scope. [Input definition](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/SynthesisInput) distinguishes raw text from other input types. [Chirp 3 HD](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd), [voice catalog](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types), and [pricing](https://cloud.google.com/text-to-speech/pricing) were checked on 2026-09-28. Provider selection and terms are documented separately; no quality ranking is inferred.
