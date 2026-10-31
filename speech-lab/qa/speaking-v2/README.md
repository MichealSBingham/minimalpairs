# Speaking screen v2: restore live exploration

2026-10-07. Stage 1 experiment. Paid spend: $0. No production integration.

## Failure observed in the user's actual tab

Read-only inspection found four microphone attempts, all withheld with `early_speech`: “The quiet check included a voiced sound.” The server was reachable. This establishes that the opening background check blocked those attempts before the central vowel measurement. It does not establish whether the sound was the user speaking early, another voice, or a device/background artifact. Audio was not downloaded or listened to; the four recordings remain untouched in the original tab. A new preview tab preserves that session.

The previous screen had deliberately removed the live dot in favor of a slower, better-tested method. That broke the user's central interaction requirement. Passing fake-device tests did not mean that the screen worked for this user.

## What changed

- A separate **Start live view** control runs browser-local LPC analysis on a rolling 60 ms window, with at most one worker request outstanding. There is no forced opening quiet check. Input audio is discarded as the window advances; no live audio is uploaded or recorded.
- The dot follows changing estimates. Rejected frames clear the dot and trail immediately; a watchdog clears stale points within approximately 300 ms. Smoothing resets across gaps. It is labelled approximate and never snapped to a target or assigned a correctness score.
- The original LPC estimator is copied unchanged from `vowel-map/public/dsp.mjs`. A wrapper adds clipping-first and single-tone rejection. The single-tone check is run at a fixed sample rate, excluding resampling edges, to avoid treating oversampled speech as a pure tone.
- A background guard waits for at least 400 ms and eight observations of low-level or nonperiodic input. It uses the median observed level and withholds a point when the candidate vowel is less than 20 dB above it. Short fricatives do not establish the baseline; periodic held vowels do not update it. No observed baseline is labelled “background not yet checked.” This is a development heuristic, not a validated noise or speaker detector.
- Separate microphone level, input name/selector, tracking messages and optional diagnostic export distinguish permission, input, tracking and analysis failures. Diagnostics include bounded raw estimates and gaps, not audio.
- Audio startup begins within the button gesture. Cancellation releases late-arriving streams. Missing audio, suspended audio and stalled workers recover rather than leaving a frozen interface. Live practice pauses after one minute or when the document is hidden; Pause releases microphone tracks.
- Live view remains available when the word-analysis API fails. The slower word recorder retains its stricter gates; the message for an unusable quiet check no longer assumes the user spoke too early.
- The chart and Start button precede the word recorder on mobile. All existing record/replay functionality remains available separately.

## Verification

- 9 existing backend tests passed. The central-word measurement algorithm and gates were not loosened.
- 8 HTTP checks passed, including source-file denial, origin/host restrictions and invalid inputs.
- 14 record/replay browser regression checks passed: [receipt](word-regression/browser-results.json).
- 16 new live-browser checks passed: [receipt](live-browser-results.json). Uses credited speech through fake microphones and synthetic added noise. Includes changing raw estimates, dot removal, track release, API outage, permission denial/cancellation, no-audio/worker/startup timeouts, diagnostic export and a 390×844 touch viewport with the whole chart and start button visible.
- 10 background-guard behavioral assertions passed. Silence, white noise, pure tones and clipped controls were withheld at 16, 44.1 and 48 kHz (15 cases).
- Desktop/mobile screenshots were inspected, and the actual in-app browser loaded the new interface. No physical microphone was activated by the agent. No actual phone/Safari/Continuity microphone verification occurred.
- The optional Mac launcher passed shell syntax validation; its open-browser action was not run. The server was started and checked directly instead.

## Accuracy warning: restoring a dot does not fix the estimator

[Acoustic probe](acoustic-probe.json): 2,232 60 ms frames, 558 adult /ɪ/–/i/ reference points under four conditions. This is reused Hillenbrand development data, not held-out learners. Positions were sampled at human reference times, not automatically located. The results below are **the fast estimator before the temporal background guard**; they do not measure the full live pipeline's accuracy.

| Condition | Accepted / 558 | Large errors among accepted | F2 mean absolute error |
|---|---:|---:|---:|
| Clean | 421 | 20 / 421 (4.8%) | 76.7 Hz |
| Added white noise, 20 dB SNR | 442 | 29 / 442 (6.6%) | 96.1 Hz |
| Added white noise, 10 dB SNR | 490 | 274 / 490 (55.9%) | 566.0 Hz |
| Telephone bandpass, 300–3400 Hz | 350 | 54 / 350 (15.4%) | 168.2 Hz |

A large error is |F1 error| >150 Hz or |F2 error| >300 Hz. All 20 clean large errors occurred in the corpus's adult-women group. Device processing and higher voices remain important failure cases. Per-frame CPU compute p95 was approximately 1.5 ms on this Mac at 16 kHz; that is not end-to-end latency or a phone benchmark.

A post-hoc stricter periodicity cutoff of 0.95 removed all accepted 10 dB noise frames, but retained only 208/558 clean frames, with 15 large errors still accepted. It was **not adopted**: it lost too much useful input without resolving resonance errors. The temporal background guard instead has a demonstrated refusal on one browser fixture with noise preceding speech. There is no claim that it eliminates the error rates above. Other voices, changing background, speech without a background observation and filtered microphones can still evade it. A long unvoiced speech sound can also contaminate the background estimate and temporarily reduce coverage.

The pre-wrapper-development run is preserved in `acoustic-probe-before-guard.json`. Reproduction scripts are `prepare_live_probe.py`, `test_live_analysis.mjs`, `test_live_quality.mjs`, and `test_live_ui.mjs`. Public/example audio fixtures stay in `/tmp/minimalpairs-speaking-qa`, outside product assets. No user audio is included in this QA folder.

## Next test

Start live view with an actual built-in microphone and then the user's phone microphone, holding “ih” and “ee” with ordinary quiet gaps. Check input name, meter, dot response, dropout and direction of movement; export diagnostics only when desired. Separately test natural words and retain consented audio for independent listening and acoustic inspection. Do not add IPA targets, corrective coaching or a public API until those measurements support them.
