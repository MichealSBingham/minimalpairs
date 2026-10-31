# MinimalPairs speech lab

Isolated research for the speaking feature. Read [the roadmap](../SPEECH-ROADMAP.md) and [current status](STATUS.md) before continuing work.

## Try the speaking prototype

Double-click **Open Speaking Lab.command** in this folder, or start it from the repository root:

```sh
speech-lab/.venv/bin/python speech-lab/speaking_server.py
```

Open **http://127.0.0.1:8767** on this Mac and press **Start live view**. Hold the vowel in *ship* (“ih”), then *sheep* (“ee”). A blue dot follows the estimated sound; it disappears when tracking fails. Live practice has no forced quiet countdown and pauses after one minute. Use **Microphone & troubleshooting** to inspect/select the input and explicitly save diagnostics. A phone used as the Mac's microphone is different from opening this loopback URL on a separate phone; no remote phone hosting is configured.

The separate word recorder provides replay and a slower measurement. Stay quiet during its short background check, then speak when prompted. This stricter path may withhold a point; use live exploration if the opening check keeps rejecting the recording. Uploads and credited example audio remain available.

Both paths are experimental acoustic measurements, not correctness grades. Noise, higher voices and device processing can still mislead them. Live audio stays in the browser; word audio is sent only to this Mac. Recordings remain in tab memory; use **Save audio** and **Export measurements** explicitly to keep them.

Read [v2 verification and known failures](qa/speaking-v2/README.md); [v1 verification](qa/speaking-v1/README.md) is historical. The older `server.py` and `static/` remain the historical prototype; the new screen uses `speaking_server.py`, `speaking_engine.py` and `speaking/`.

To reproduce this interface's checks with the server running:

```sh
speech-lab/.venv/bin/python -m unittest discover -s speech-lab -p test_speaking.py -v
speech-lab/.venv/bin/python speech-lab/prepare_speaking_fixtures.py
speech-lab/.venv/bin/python speech-lab/test_speaking_http.py
node speech-lab/test_speaking_ui.mjs
speech-lab/.venv/bin/python speech-lab/prepare_live_probe.py
node speech-lab/test_live_analysis.mjs
node speech-lab/test_live_quality.mjs
node speech-lab/test_live_ui.mjs
```

Browser checks reuse the project's installed Playwright package and Chromium. The microphone is simulated with credited example audio; an emulated mobile viewport does not replace testing actual hardware.

Existing `artifacts/*v1*` and 2026-10-04 results are historical exploratory baselines. They do not support pronunciation grading. New experiments belong in separate versioned directories with frozen settings, source provenance, output records, and interpretation limits.

The local `.venv` contains the research dependencies listed in `requirements-lock.txt`. Model weights and audio under `models` and `data` remain local and ignored by Git. Do not commit recordings, credentials, or downloaded model weights.

## Reproduce the tracker comparison

From the repository root:

```sh
speech-lab/.venv/bin/python speech-lab/fetch_tracker.py --verify-only
speech-lab/.venv/bin/python -m unittest discover -s speech-lab -p test_tracker_compare.py -v
speech-lab/.venv/bin/python speech-lab/run_tracker_comparison.py --verify-only
speech-lab/.venv/bin/python speech-lab/run_tracker_comparison.py
```

On a fresh checkout, create the environment from `requirements-lock.txt`, then run `fetch_tracker.py` without `--verify-only` to download the pinned public model. Downloading is separate from inference. Each asset is hash-checked before use; no upstream installer is run. Retain the upstream MIT notice when distributing its code.

The benchmark also needs `accuracy-lab/data/hillenbrand/h95-alldata.zip` and the prior `benchmark-clips.json` for the reference regression test. The archive is available from [the Hillenbrand mirror](https://github.com/santiagobarreda/hillenbrand_et_al_1995); local corpus files remain ignored. Refer to that data's provenance separately from the model's code license.

Settings and research interpretation are in [the experiment directory](experiments/2026-10-07-tracker-comparison/). A full run writes per-recording measurements, aggregate errors and coverage, input controls, stress tests, timing, and a complete-run receipt. It overwrites outputs in that dated directory; use a new directory and protocol version for changed methods. This is offline research with human-provided vowel timing, not an automatic pronunciation API or live microphone test.

After the full run, `speech-lab/.venv/bin/python speech-lab/ablate_tracker_fusion.py` reproduces the post-hoc neural-veto comparison from saved measurements. `speech-lab/.venv/bin/python speech-lab/probe_vowel_regions.py` reproduces the separate localization probe. Both save their own protocol, outputs and execution receipt. Start with [the readable results](experiments/2026-10-07-tracker-comparison/results.md), not the raw output files.
