# Automatic vowel location results

The simple periodicity detector is useful as a candidate for finding a vowel's interior, but is not accurate enough to identify its full duration. Keep it out of duration grading and full-trajectory feedback.

This exploratory run used all 1,668 matched Hillenbrand recordings from 139 speakers. These are largely clean, isolated /hVd/ words, with a single vowel and human boundary annotations. The corpus was already used in development; this is not independent validation on learners or on *ship/sheep*.

| Measurement | All recordings | Adult /ɪ/ and /i/ recordings |
| --- | ---: | ---: |
| Recordings | 1,668 | 186 |
| Detector returned a region | 100% | 100% |
| Both boundaries within 30 ms | 31.5% | 30.1% |
| Mean onset absolute error | 10.5 ms | 11.8 ms |
| Mean offset absolute error | 50.2 ms | 54.4 ms |
| 95th percentile offset error | 125.6 ms | 139.0 ms |
| Predicted midpoint inside annotated vowel | 100% | 100% |
| Mean fraction of predicted interval inside vowel | 83.2% | 80.4% |

The systematic late offset is consistent with including trailing voiced material. This is a hypothesis from the timing results, not a phonetic diagnosis of every recording. A correct midpoint does not make the surrounding interval correct.

A post-hoc diagnostic found that a 60 ms window around the predicted midpoint was entirely inside the annotated vowel for 1,650/1,668 recordings and 183/186 adult /ɪ/–/i/ recordings. This suggests testing conservative interior sampling next. It does not validate a 60 ms rule or prove that this later midpoint represents the same vowel quality as the true midpoint. No boundary threshold was tuned during this run.

The next test must include /ʃVp/ words, low-volume endings, voiced consonants, two-word input, silence and actual microphones. Until then, the consumer prototype should say it is measuring the vowel's central sound and avoid presenting a precise duration or complete trajectory.

The source settings are in [protocol.json](protocol.json), individual predictions in [rows.json](rows.json), summaries in [summary.json](summary.json), and execution hashes in [run.json](run.json). Paid spend: $0.
