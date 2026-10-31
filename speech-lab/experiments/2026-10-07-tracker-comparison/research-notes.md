# Research decisions for vowel measurement

The first consumer feature should help someone hear and see the difference between their attempts at a vowel contrast. Its measurement must work without knowing which answer the learner intended. This experiment tests that component before adding a correctness score or coaching instructions.

## What we take from earlier work

[V(is)owel (2025)](https://arxiv.org/html/2507.06202v1) provides a useful interaction model: replayable vowel trajectories, comparisons between attempts, and a short introduction to the chart. It also describes calibration using four elicited vowels and smoothing noisy estimates. We should test whether calibration preserves a learner's errors instead of normalizing them away, and whether people understand the chart without treating it as a literal picture of their tongue. The paper's chart is a design reference, not independent validation of our product.

[Shrem, Kreuk and Keshet's heat-map tracker](https://arxiv.org/html/2206.11632v1) offers a runnable neural baseline. Its paper evaluates VTR-only and combined-corpus training; the combined version includes Hillenbrand. The downloaded checkpoint's exact training split is unverified. Therefore our Hillenbrand run is an exploratory comparison with possible training overlap, even though we do not fine-tune anything. The paper's published averages also use a different aggregation procedure, so our numbers are not a direct replication of its result table.

[Research on pitch-induced measurement error](https://pmc.ncbi.nlm.nih.gov/articles/PMC6909981/) motivates testing high-pitched voices separately. A stable estimate can still be systematically wrong. We retain raw estimates and report large errors as well as means.

[Praat's Burg analysis](https://praat.org/manual/Sound__To_Formant__burg____.html) is the conventional baseline. Different ceilings can yield different formants. We compare one fixed ceiling, agreement between two ceilings, and agreement with a neural estimate. Choosing a ceiling using the expected vowel would contaminate the measurement and is prohibited here.

## Implementation findings before corpus evaluation

The pinned model is [FormantsTracker at e8a11b6](https://github.com/MLSpeech/FormantsTracker/tree/e8a11b66298593d8925c25733895983e11a4b3d6). It has an MIT license. Preserve its notice for any redistribution; the research audio has separate provenance and is not bundled into a product.

- Feature normalization must divide spectral power by Hann-window energy. Using FFT-size normalization changes the input distribution despite similarly named settings.
- The upstream loader pads recordings to the longest example in each batch. On its published example, inference without that extra padding changed 12 of 696 output coordinates, all near the end. Adding 64 zero spectral frames and cropping the output matched all published coordinates within integer rounding (maximum difference 0.985 Hz). The adapter fixes right padding explicitly so another recording's length cannot change an attempt's result. This is an integration finding, not a claim of a novel research method.
- This model uses future context. Counting convolutional dependencies gives an F2 right radius of 40 frames, plus three smoothing frames and approximately 16 ms for the centered spectrum: about 446 ms, before inference, buffering, transport, and rendering. Interpolation between 10 ms frames can add up to another frame. This is an architecture-derived bound for matching full-context output, not a measured end-to-end latency. F3 uses still more context. The prefix experiment measures sensitivity on four examples; it cannot establish general streaming accuracy.
- The archive spells one vowel both `ei` and `ey`; normalize identifiers before matching labels and audio. Four midpoint references differ between `vowdata.dat` and `bigdata.dat` (b02iy, b13er, g08iy, w49eh). Use `bigdata.dat` consistently for every method and point in this experiment. This source discrepancy is covered by a regression check.

## Consumer decisions this experiment can inform

| Risk | Decision or test |
| --- | --- |
| A pleasing dot conceals a bad estimate | Keep raw measurements; compare with independent acoustic references; omit unreliable coordinates. |
| Agreement is mistaken for certainty | Measure error among accepted estimates and how much speech is withheld; agreement is not a confidence percentage. |
| A recognizer guesses the expected word | Keep intended words and reference labels out of the formant estimator. |
| The display is silent for some voices | Report coverage by voice group and pitch, alongside error. |
| A slow model is presented as live | Separate future-audio delay from compute time; consider careful feedback after recording first. |
| Silence or a tone draws a vowel | Test explicit no-speech controls; do not interpret neural coordinates as evidence that speech exists. |
| A short sound is omitted from analysis | Evaluate vowel location separately; current reference times are supplied by human annotations. |
| Microphone processing changes the chart | Stress gain, noise, filtering and sample-rate conversion, then test actual microphones. |
| The chart rewards exaggerated isolated vowels | Evaluate ordinary words and later new words without the chart. |

## Next independent test

Freeze the selected candidate before evaluating a new recording set. Begin with consented adult voices producing /ɪ/ and /i/ in several words, including *ship/sheep*, repeats, and at least two actual recording setups. Keep speaker IDs and related recordings together. Record both comfortable pitch and deliberate pitch changes without asking speakers to change the vowel. Obtain blinded vowel-identity judgments independently of the requested word; reserve acoustic spot checks for disagreement and suspicious tracks.

The first small set is for discovering failures, not estimating market-wide accuracy. A handful of expert-rated clips can fit the pilot budget; comprehensive expert annotation cannot be promised for $100. No paid reviewer or participant has been hired, and no microphone recording was collected during this experiment.

Before any pass/fail feature, choose error and coverage requirements using the cost of misleading a learner, then evaluate on untouched speakers. Synthetic degradation and native-word labels cannot substitute for this test.

## Other candidates reviewed

The [FormantNet ONNX export](https://huggingface.co/FredrikKarlssonSpeech/FormantNet) is a possible smaller recurrent alternative. At inspected revision `5877b89fc6bd0c7ba90be255f78e12419790af28`, its metadata explicitly requires normalization using a training `Normfile`, but that file is absent from the repository listing and its statistics are absent from metadata. Preprocessing and output conversion also remain outside the model. The [original implementation](https://github.com/NemoursResearch/FormantNet/tree/main/User) explains why the saved training statistics are required. Do not replace them with statistics calculated from each test utterance. Defer quantitative comparison until preprocessing, checkpoint configuration and reference predictions can be reproduced. Conversion parity is not evidence of acoustic accuracy. Use the verified [Lilley and Bunnell paper](https://www.isca-archive.org/interspeech_2021/lilley21_interspeech.pdf) for attribution; the export card has a different citation.

[FastTrack](https://github.com/santiagobarreda/FastTrack) is another conventional candidate that selects among several Praat analyses across an interval. Evaluate this if fixed-ceiling rejection discards too much useful audio. It does not eliminate the need to validate automatic vowel boundaries.

[Work combining neural and linear-prediction estimates](https://arxiv.org/abs/2308.09051) already explores this broad hybrid direction. Our simple agreement experiment is an engineering comparison, not a proprietary invention or a claim to improve on that paper's method. Its value will depend on independently measured reliability and useful feedback.
