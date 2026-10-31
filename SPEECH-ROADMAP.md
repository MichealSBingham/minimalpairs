# MinimalPairs speaking and coaching roadmap

Last updated: 2026-10-07. **Current stage: 1 — measurement research and offline testing.**

First checkpoint completed: [1,668-recording comparison and failure audit](speech-lab/experiments/2026-10-07-tracker-comparison/results.md). A guarded measurement candidate improved clean-recording reliability; noise, processed audio and vowel boundaries remain unresolved. Stage 1 stays active. Next work is recorded in [the status log](speech-lab/STATUS.md).

The [local speaking test screen](speech-lab/README.md) now includes a restored live vowel explorer and a separate word recorder. The first user session failed at the opening quiet check; live mode avoids that forced check. Automated repair checks passed, but physical microphone retesting and independent learner validation remain next. The screen is a Stage 1 testing tool, not completion of Stage 2.

MinimalPairs currently teaches listening. The next capability lets learners speak a contrast such as *ship/sheep*, see useful acoustic feedback, and compare attempts. The long-term goal is a conversational coach that accurately hears pronunciation and accent in ordinary speech, eventually adding useful visual observations of the mouth. A one-contrast prototype is the first technical test, not the limit of that vision.

## Start here on every work session

Read this roadmap and [the current experiment status](speech-lab/STATUS.md). Keep both current when a stage changes. Record actual tests, negative findings, costs, unresolved limitations, and the next experiment in the status record. Do not call a stage complete because code exists or a dot looks smooth.

Work stays in the isolated `speech-lab` until validation supports integration. The existing `vowel-map` and `accuracy-lab` contain exploratory work. The listening product in `rescue/app` is not part of this research increment.

## Technical sequence

| Stage | Technology and purpose | Exit evidence | Status |
| --- | --- | --- | --- |
| 1. Measure reliably | Microphone/recording input; compare conventional and learned vowel trackers; test audio-model judgments; build reproducible evaluations. | Quantified measurement error, failure cases, useful coverage, delay and cost. Independently reviewed real recordings are required before correctness claims. | Active |
| 2. Speaking feedback | Live vowel region/trail when reliable; careful feedback after a word; target regions, replay, repeated attempts. | Actual microphone/device testing and learners understanding the display; human agreement with corrections. Release after-recording feedback first if live tracking is unreliable. | Not started as a validated feature |
| 3. Broader speech assessment | More vowels and consonants, phrases, stress and rhythm, selected target-accent profiles. | Separate evaluations for each capability, unfamiliar speakers and words, acceptable variation and uncertainty. | Planned |
| 4. Conversational coach | GPT-Live or another voice interface plus whichever assessment methods work; open conversation, evidence-supported corrections and retries. | Accurate and useful feedback in open conversation, and improvement on new speech without visual assistance. | Planned |
| 5. Audio and camera | Mouth/lip observations and audiovisual assessment. | Demonstrable benefit over audio alone; do not infer hidden tongue position from face landmarks. | Research direction |

Planning windows: stage 1 is initially a 1–2 week focused investigation; stage 2 may take a following 2–4 weeks if measurement succeeds. These are estimates, not deadlines or claims that the $100 budget funds the whole roadmap. Later stages have no promised dates.

## Parallel investigations and packaging

- During stage 1, design a small broad-listening comparison for audio-capable models: same words with different pronunciation, acceptable target-accent variants, stress/rhythm, and uncertainty. Do not assume a vowel tracker is the foundation of every later capability.
- Package proven stage-2 capabilities as an embeddable widget and assessment API. Pimsleur and other companies are prospects, not confirmed buyers.
- Bingham Intelligence can reuse evaluation methods for a speech/tutor audit offer. Keep client data and training rights separate. This is secondary to obtaining credible evidence.
- Fine-tune an open model only after identifying a repeatable baseline weakness and establishing suitable data and evaluation. Do not train a foundation model from scratch.

## First build and consumer requirements

The first build is a reproducible measurement workbench and comparison report, followed by a useful speaking interface. It is not another polished demo before testing.

1. Fast path: estimate vowel acoustics during speech, with an explicit uncertain state.
2. Careful path: after recording, locate the relevant sound and compare it with an appropriate reference distribution.
3. A chart distance is not a pronunciation percentage. F1/F2 do not establish whole-word correctness, exact tongue position, or regional-accent identity.
4. Keep audio measurements independent of the intended word. Do not snap estimates onto the target or use target-conditioned normalization that makes incorrect speech look correct.
5. Retain raw estimates and gaps; smoothing cannot count as improved measurement accuracy. Reset after silence and distinguish no measurement from a stable vowel.
6. Test voices and pitch ranges separately. Stability, low mean error and visually pleasing motion can hide large errors for some speakers.
7. Begin with one American-English vowel contrast, then expand on evidence. Use multiple reference speakers and account for speaking context. Do not judge the final consonant from the vowel alone.

## Budget and evidence

The user authorized up to $100 for the first validation pilot. Confirmed spend at restart: $0. Use public/local data first. Reserve funds for limited expert review and bounded API experiments; record paid and uncertain charges separately.

The existing corpus was used in prior tracker development. New partitions of it are development partitions, not genuinely untouched validation. Artificial noise or resampling tests establish engineering sensitivity, not performance on independent microphones or learners.

Advancement depends on three separate questions: (1) does measurement/assessment agree with independent labels; (2) do people understand and use it; (3) does improvement transfer to new speech? None is established by a functioning implementation alone.

## Sources

- [V(is)owel, 2025](https://arxiv.org/html/2507.06202v1): confirmed design reference; useful visual targets, but formant errors and interpretation difficulties.
- [Praat Burg formant analysis](https://praat.org/manual/Sound__To_Formant__burg____.html).
- [FormantNet implementation](https://github.com/NemoursResearch/FormantNet).
- [Probabilistic formant heat maps](https://github.com/MLSpeech/FormantsTracker).
- [Earlier research memo](research/vowel-feedback-product-research-2026-09-16.md).

## Decisions

- 2026-10-07: User authorized saving this roadmap and beginning research, testing and the first build. Prior research-only pause is superseded for this isolated work. No production integration or outreach is requested in this increment.
- 2026-10-07: Prioritize the listening-to-speaking transition. Broad conversational hearing remains the long-term goal; a narrow lesson is not its replacement.
- 2026-10-07: Complete first offline tracker comparison, input stress tests and localization probe for $0. Carry conventional measurements with a neural veto into further testing. Prefer after-recording feedback initially; no live-map, correctness or consumer-release claim yet.
- 2026-10-07: Build and verify the isolated local speaking test screen with guided recording, replay, central measurements and explicit uncertainty. Keep Stage 1 active pending actual microphone sessions and independent review.

- 2026-10-07: User reported four unsuccessful attempts and the missing realtime dot. Restored explicitly experimental live exploration with input diagnostics, uncertainty gaps and a background guard. Keep careful word measurement separate. Documented severe noise sensitivity; do not promote this to validated assessment.
