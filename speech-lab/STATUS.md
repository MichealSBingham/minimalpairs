# Speech measurement experiment status

Updated: 2026-10-07. Stage 1 active. Start with [the roadmap](../SPEECH-ROADMAP.md).

## Current work

The first real user session failed: four word attempts were blocked by the opening quiet check. A separate browser-local **live vowel view** is now restored at `http://127.0.0.1:8767`, with no opening countdown, input diagnostics and an experimental background guard. The user's original tab and recordings were preserved. The slower word checker retains its existing gates. Start with [v2 findings and verification](qa/speaking-v2/README.md). Actual microphone retesting is next; no method is approved for correctness grading.

## Verified starting evidence

The 2026-10-04 artifacts are preserved. `artifacts/summary.json` records exploratory results, not a validated product:

- A naive phoneme-mismatch diagnostic produced 504 false flags among 1,477 aligned acceptable phones. Its 24 correct detections among 528 flags do not support consumer correction.
- On previously reused Hillenbrand midpoint clips, a two-ceiling Praat consensus retained 1,308/1,655 clips. Accepted F2 mean error was about 49 Hz, but the corpus's girls subgroup had only 128/227 accepted clips and about 847 Hz F2 error at its 95th percentile.
- The 24-word contrast experiment represents four credited speakers and source word labels, not independently reviewed pronunciation correctness.
- No live microphone, independent learner correctness, or learning-outcome validation has been completed.

## This session

- Roadmap saved; stage and evidence tracking established.
- Five-method comparison completed on 1,668 recordings from 139 speakers, with 4,978 measurable reference points. Settings frozen in `experiments/2026-10-07-tracker-comparison/protocol.json`; no held-out claim.
- Pinned neural adapter reproduces 232 upstream example frames within published integer rounding. Fixed a batch-padding dependency near recording ends and audited four source-label discrepancies. Six regression checks pass.
- Automatic vowel-region localization probe complete: 1,668 recordings, 100% midpoint containment, but both full boundaries within 30 ms on only 31.5%. Full-duration feedback is rejected for this heuristic. See `experiments/2026-10-07-vowel-localization/results.md`.
- CPU timings are local observations, not controlled device benchmarks; some localization processing ran alongside the tracker comparison.
- Post-hoc fusion ablation complete: retain conventional coordinates and use neural agreement as a veto. On all clean points, coverage was 82.4%, F2 mean error 41 Hz, and large errors 36/4,104 accepted points (0.88%). The previous two-ceiling baseline had 77.7% coverage, 57.5 Hz and 105/3,867 (2.72%). These are acoustic errors, not pronunciation accuracy.
- On the intended adult /ɪ/–/i/ subset, veto coverage improved to 83.2% from 75.1%, but large-error counts were 4/464 versus 3/419. Do not claim every subgroup or metric improved.
- Release blocker: veto estimates still had 4/46 large errors on added-noise copies and 10/34 on telephone-filtered copies. The current input gate accepted those recordings. Synthetic control rejection does not solve this problem.
- Delay: neural full-recording compute median 341 ms, p95 431 ms, plus future-context requirements. Use as a candidate after recording; live microphone latency is unverified.
- Confirmed paid spend: $0 of $100. No paid calls, recruitment, expert labels or outreach occurred.

## Current candidate

The conventional tracker with neural veto is selected for the next **development experiment**, not for release. Preserve averaging and two-ceiling baselines. Ablation implementation: `ablate_tracker_fusion.py`; outputs and post-hoc protocol: `experiments/2026-10-07-agreement-veto/`. The original five-method implementation and results remain unchanged.

The record/replay/central-vowel comparison interaction is implemented in the isolated local screen. It includes background checking, explicit uncertainty, example attribution, optional exports and no automatic audio storage. Whole-vowel timing, calibrated target regions and correctness scores remain unimplemented and unvalidated. Follow [the first recording protocol](NEXT-RECORDING-TEST.md).

## Speaking screen checkpoint

- New implementation is isolated in `speaking_engine.py`, `speaking_server.py` and `speaking/`. Historical code and frozen benchmark files were preserved.
- Nine backend checks, eight HTTP checks and fourteen browser checks passed. Desktop and mobile layouts were visually inspected. Evidence: `qa/speaking-v1/verification.json`.
- The browser test used a simulated microphone with credited reference audio, not the user's microphone. Actual browser microphone capture, room/device robustness, listener agreement and learning remain unverified.
- Fixed a duration-boundary rounding bug exposed by padded/shifted recordings. The recorder flushes final samples and releases microphone tracks. Failed analysis retains replayable audio without displaying a point.
- Two of four available reference recordings produced a point; the other two were withheld. The successful speaker is the selected demo default, not a representative accuracy sample.
- New central-window, background and aggregation rules are development candidates. Earlier benchmark error rates do not establish the new interface's accuracy. Noise and processed-audio weaknesses remain.
- Paid spend remains $0. No outreach or production integration occurred.

## Next evidence needed

1. Test unreliable/processed audio and conservative vowel-interior selection on actual *ship/sheep* recordings. Do not trust agreement alone or use the present locator for vowel duration.
2. Collect independent voices and blinded vowel-identity judgments; inspect suspicious acoustic measurements. Freeze candidate settings before the independent evaluation.
3. Test the implemented screen with actual browser microphones and mobile devices; use explicit exports to retain recordings for review.
4. Test target normalization and listener agreement before correctness feedback; test transfer before claiming learning benefits.

## Live-view repair checkpoint

- Observed the user's four `early_speech` rejections directly in the existing page; server availability was verified. This identifies the gate that blocked feedback, not the actual sound source. No user recording was downloaded or listened to.
- Restored browser-local 60 ms live analysis, bounded worker queue, immediate uncertainty gaps and stale-point expiry; mobile chart/control order corrected. Retained raw measurements/gaps in optional local diagnostics. Input selector, permission cancellation, audio-startup timeout, no-audio timeout, worker timeout and explicit microphone release implemented.
- Added a temporal background-level guard without a forced opening calibration. One noisy browser fixture demonstrated refusal; this is not noise-robustness validation. Other voices, processed audio and missing/contaminated background observations remain weaknesses.
- 16 live-browser checks and 14 existing record/replay browser checks passed, plus 9 backend, 8 HTTP, 10 guard assertions and 15 nonspeech controls. Fake microphone and mobile viewport only; no actual phone or physical microphone test by the agent.
- New reused-data probe: 558 adult /ɪ/–/i/ reference points per condition. Before the temporal background guard, clean fast-path errors were 20/421 accepted points; 10 dB added noise produced 274/490 large errors. Do not describe the fast path as accurate coaching. Full evidence: `qa/speaking-v2/`.
- Current next step: real built-in/phone microphone comparison, then independently reviewed speech. Stage 1 remains active. Spending remains $0/$100. Production and outreach untouched.
