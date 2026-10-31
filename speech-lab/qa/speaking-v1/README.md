# Speaking prototype verification

The local single-word screen is operational at `http://127.0.0.1:8767` while `speaking_server.py` is running. It supports word selection, credited human examples, microphone recording, upload, replay, comparison, optional measurement export and individual audio downloads. Audio is handled in memory and is not saved automatically.

The interface displays a central vowel measurement after the recording. It does not recognize the requested word, judge correctness, grade vowel duration or provide live vowel tracking. Labels on attempts are the selected prompts. Reference recordings are visibly marked as examples from another speaker.

## Completed checks

- Nine Python checks passed: invalid formats/rates/durations; stereo conversion and resampling; silence/noise/tone/clipping; one-word measurement; quiet-prefix measurement; speech during the quiet check; noisy background; separated words; and sub-frame onset shifts.
- Eight HTTP checks passed, covering normal loading, inaccessible source files, host/origin rejection, invalid audio, empty uploads and unknown examples.
- Fourteen browser checks passed, including two example recordings, replay, export, no fabricated point on an uncertain result, clearing, microphone capture through an AudioWorklet, automatic stop and track release, WAV download, failed-analysis recovery, reload privacy, microphone denial, upload fallback and mobile layout.
- Desktop and 390-pixel mobile screenshots were visually inspected. Chart labels are enlarged on the mobile layout and placed to avoid collisions in the tested example pair.

The browser microphone was a simulated stream using an existing credited recording. This checks the capture path, not the user's physical microphone, room acoustics or a real mobile device. Playback started successfully; no independent listening judgment was made.

## Findings and fixes

The interface retains audio even if the analysis request fails, allowing replay or download. Uncertain attempts have no point; the previous attempt is explicitly labelled and cannot become the new result. The worklet flushes its last partial buffer on stop, and microphone tracks close before analysis.

A boundary comparison initially rejected some otherwise identical padded recordings: floating-point subtraction could put a 90 ms region just below the cutoff. The engine now compares integer milliseconds. Regression checks cover five sub-frame onset shifts; the browser microphone test then passed with the final code.

Of the four available example recordings, both Grendelkhan recordings produced measurements, while both Dvortygirl recordings were withheld by the region checks. Grendelkhan is the default demo speaker to provide a usable demonstration; the other speaker remains available. This is deliberate demonstration selection, not independent evidence of pronunciation accuracy or broad voice coverage.

## New development settings

The interface applies a guided 600 ms quiet prefix to microphone captures. It uses the 100–500 ms portion to estimate background energy and rejects a voice/background margin below 25 dB. Early periodic speech, obvious nonspeech controls and separated energy regions can also cause rejection. These are engineering filters, not calibrated noise or word detectors. Uploads and examples have no guided background measurement.

It samples seven points over 60 ms around the automatic region midpoint, retaining conventional coordinates only where neural agreement passes the previous thresholds. At least five points must agree. The median is displayed, with interquartile whiskers; excessive spread withholds the result. A 1.4-second context window around the midpoint bounds inference cost. These additional selection and aggregation rules have **not** received a corpus-wide acoustic or learner-accuracy evaluation. The earlier benchmark's error rates must not be advertised as this interface's accuracy.

Known limits remain: processed or noisy audio can pass; reference voices can fail; automatic vowel location can be wrong; the background check can reject legitimate attempts. No target normalization, pass/fail labels, calibrated confidence or learning claim is implemented.

## Next evidence

Try real microphone recordings of both words. Explicitly export audio and measurement metadata for review if desired. Follow [the independent recording protocol](../../NEXT-RECORDING-TEST.md), inspect failures across devices and voices, and evaluate the new selection rules before adding corrections. Stage 1 remains active. Paid spend is still $0.

The machine-readable receipt is [verification.json](verification.json). Screenshots show example audio, not the user's voice: [desktop](desktop-examples.png), [mobile](mobile-examples.png).
