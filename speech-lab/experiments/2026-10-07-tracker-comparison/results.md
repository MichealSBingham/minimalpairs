# Vowel measurement comparison results

The most promising candidate for the next experiment is **a conventional formant measurement checked by a neural tracker**, with feedback after recording. Using the neural tracker alone made measurements worse here. Agreement reduced large errors on clean recordings, but did not protect against noise and severe filtering. No method is approved for pronunciation grading or consumer release.

## What was tested

The full run completed on 1,668 recordings from 139 speakers, using 4,978 measurable reference points at 20%, 50% and 80% through the vowel. Twenty-six points with unavailable F1 or F2 labels were excluded and recorded. All methods received the same recordings and references. The estimator never received the expected vowel or reference coordinates.

This is the previously used Hillenbrand corpus, largely isolated /hVd/ words. The neural checkpoint may also overlap it in training. Vowel timing was supplied by human annotations. These are exploratory acoustic measurements, not independent tests of learners, *ship/sheep* correctness, live microphones or learning.

## Clean recording results

Coverage is the fraction of reference points for which the method returned an estimate. Errors are calculated only for those accepted points. A “large error” here means F1 error above 150 Hz or F2 error above 300 Hz; it is an engineering threshold, not a pronunciation standard. F1 and F2 are the two acoustic measurements used to place a vowel on the map.

| Method | Coverage | F1 mean error | F2 mean error | F2 error at 95th percentile | Large errors among accepted |
| --- | ---: | ---: | ---: | ---: | ---: |
| Conventional tracker, fixed setting | 100.0% | 16.9 Hz | 81.3 Hz | 302.4 Hz | 263/4,978 — 5.28% |
| Previous two-setting agreement | 77.7% | 14.0 Hz | 57.5 Hz | 146.9 Hz | 105/3,867 — 2.72% |
| Neural tracker alone | 100.0% | 47.1 Hz | 184.6 Hz | 1,103.3 Hz | 695/4,978 — 13.96% |
| Fixed conventional and neural agreement, averaged | 82.4% | 18.2 Hz | 46.6 Hz | 115.5 Hz | 38/4,104 — 0.93% |
| Select among six settings to match neural estimate | 90.2% | 22.6 Hz | 86.6 Hz | 227.8 Hz | 206/4,492 — 4.59% |
| Conventional coordinates with neural veto, post-hoc | 82.4% | 14.3 Hz | 41.0 Hz | 121.3 Hz | 36/4,104 — 0.88% |

The veto variant was proposed after inspecting the original five-method comparison. It returns the conventional coordinates on exactly the same accepted points as the averaging method; it does not change thresholds. This controlled ablation improved mean error, although it did not improve every tail metric or subgroup. Its protocol and complete results are saved in [the separate ablation directory](../2026-10-07-agreement-veto/). It still requires independent validation.

Compared with the previous agreement baseline on this same run, the veto candidate increased coverage from 77.7% to 82.4% and reduced conditional large-error rate from 2.72% to 0.88%. Good-measurement yield—accepted points below both error thresholds divided by all points—increased from 75.6% to 81.7%. The ungated conventional method still had higher good-measurement yield, 94.7%, at the cost of more bad estimates. Thus rejection improves reliability but discards many usable measurements.

Searching more settings to obtain agreement was a poor tradeoff: coverage rose but large errors also rose. Agreement is not calibrated confidence, especially when one method chooses among many candidates offered by another.

## The first intended vowel contrast

There were 558 adult /ɪ/–/i/ reference points from 93 speakers. These are vowels in *hid/heed*-type words, not actual *ship/sheep* productions.

| Method | Coverage | F2 mean error | Large errors among accepted |
| --- | ---: | ---: | ---: |
| Previous two-setting agreement | 75.1% | 36.9 Hz | 3/419 — 0.72% |
| Fixed agreement, averaged | 83.2% | 39.5 Hz | 4/464 — 0.86% |
| Veto candidate, post-hoc | 83.2% | 32.0 Hz | 4/464 — 0.86% |

For this contrast the candidate offers better coverage and lower mean F2 error, but does **not** demonstrate fewer large errors than the previous baseline. The speaker-bootstrap F2 intervals overlap (baseline approximately 28–48 Hz, veto 25–41 Hz). Avoid claiming an established winner from these small differences.

High-voice coverage remains a concern. In the corpus's girls subgroup, fixed agreement returned only 58.7% of points; the veto variant still had 12 large errors among 400 accepted points. This is a stress subgroup, not the initial adult target audience. At reference pitch above 250 Hz, veto coverage was 70.0%, with 16 large errors among 436 accepted points.

## Noise and recording conditions

A frozen selection of 24 recordings supplied 72 reference points per condition. Copies of the same recordings were transformed; these are not new speakers or actual device tests. The following are veto-candidate results from the post-hoc ablation.

| Condition | Accepted out of 72 | F2 mean error | Large errors among accepted |
| --- | ---: | ---: | ---: |
| Same recordings, clean | 45 | 15.2 Hz | 0/45 |
| Ten times quieter | 50 | 30.5 Hz | 1/50 |
| Convert through 44.1 kHz | 45 | 15.2 Hz | 0/45 |
| Convert through 48 kHz | 45 | 15.2 Hz | 0/45 |
| White noise at 20 dB SNR | 46 | 123.4 Hz | 4/46 |
| Telephone-like 300–3,400 Hz filtering | 34 | 335.4 Hz | 10/34 |

The severe-filtering result is a release blocker for any general reliability claim. Do not interpret the experiment as saying every phone microphone applies this filter. It shows that a processed signal can produce convincing agreement on incorrect coordinates. Quiet-input acceptance also changed; normalization and microphone processing need targeted evaluation.

The explicit input gate withheld all five artificial controls: silence, white noise, two pure tones and clipped periodic audio. The raw neural model produced vowel-like coordinates on every one, including silence. Passing these controls does not establish speech detection or protect against all real-world interference.

## Delay and implementation checks

On this local CPU run, neural inference took 341 ms at the median and 431 ms at the 95th percentile per full recording. The six-setting conventional bank took 19 ms and 26 ms respectively. These are local processing observations; a brief independent localization probe ran concurrently. They exclude microphone, transport and rendering delay.

The neural network also uses future audio. In a four-recording prefix probe, using no future audio changed F2 by approximately 716–2,179 Hz relative to full-recording inference. Three examples matched with about 100 ms of future audio; the remaining example needed more and matched at 250 ms. This small probe does not establish a safe universal streaming delay. Current neural inference should support careful post-recording feedback, not be presented as a zero-delay live tracker.

The adapter reproduces 232 frames of the authors' supplied example, all within the published integer rounding. An explicit right-padding rule fixes dependence on other recordings' batch lengths. Six regression checks passed, including audio resampling, invalid inputs, no-speech controls, abstention accounting and reference-label alignment. See [research notes](research-notes.md) for source links, preprocessing details and the audit of four differing source labels.

## Decision and next experiment

Continue with the veto candidate and keep the averaging and previous conventional methods as baselines. Before building a consumer correctness display, test actual single-word microphone recordings and improve handling of unreliable/processed audio. Separately, the [localization experiment](../2026-10-07-vowel-localization/results.md) rejects the current heuristic for full-vowel timing; conservative interior sampling is only a candidate for further testing.

Use [the first recording protocol](../../NEXT-RECORDING-TEST.md) for new voices and blinded listening judgments. Then build a simple local record/replay/comparison screen. Target calibration, acceptable pronunciation, and learning transfer remain untested. Broad accent classification and conversational coaching remain later stages.

The run completed in about 11 minutes of local computation. Paid spend: **$0 of the $100 pilot limit**. Raw outputs, frozen settings, hashes, environment and complete-run receipt are stored alongside this report.
