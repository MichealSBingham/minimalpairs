#!/usr/bin/env python3
"""Write a status report from actual acquisition state, including partial runs."""
import json,pathlib
BASE=pathlib.Path(__file__).resolve().parent
read=lambda name:json.loads((BASE/name).read_text())
complete=(BASE/'manifest.candidate.json').exists()and(BASE/'verification.json').exists()
clips=read('manifest.candidate.json')['clips']if complete else read('acquisition-progress.json')['clips']
checked=read('verification.json')if complete else None
status=f'**Acquired and engineering-checked: {len(clips)} recordings, two credited contributors, all three TRAP/STRUT pairs.**'if complete else f'**Partial acquisition: {len(clips)}/12 planned recordings.** Dvortygirl’s `luck` remains missing. Wikimedia requires no retry before 20:46:00.714 UTC on 28 September; no alternate host or early retry is being used.'
stats=f'Encoded bytes: {sum(c["bytes"]for c in clips):,}. '+(f'Independent checks: {len(checked["errors"])} hard errors, {len(checked["warnings"])} engineering warnings; twelve distinct file hashes. Durations {checked["durationSeconds"]["min"]:.3f}–{checked["durationSeconds"]["max"]:.3f} seconds.'if complete else 'The 11 acquired files have matching original/output checksums and decode successfully. No complete manifest has been issued yet.')
report=f'''# English human-recording expansion audit

28 September 2026. Request: 17 distinct words across `en-zh-j`, `en-foot-strut` and `en-ae-strut`, ideally two identifiable contributors covering every word of each contrast. This was a bounded source search and acquisition, not a pronunciation listening review.

{status}

Only the `cat/cut`, `cap/cup`, `lack/luck` set has complete source-identified word coverage for two contributors. The other two requested contrasts remain incomplete. **The two-contributor General American requirement is also not fully established:** Dvortygirl’s exact files have US/GA source labels, whereas Grendelkhan declares native English but has no established regional-accent label in the sources checked. Do not label the whole candidate General American-verified.

{stats}

## Concrete acquired candidate

Grendelkhan contributes six exact words under **CC0 1.0**. Dvortygirl contributes the same six under the **CC BY-SA 3.0** option offered by the file pages. These licenses remain separate per recording; CC0 files do not inherit ShareAlike from the other contributor.

Lingua Libre filenames were treated only as discovery hints. For every selected Grendelkhan file, Commons MediaInfo **P9533** identifies the exact English word and the credited speaker entity is **Q929501**. For Dvortygirl, the source descriptions/upload comments identify the word and recorder; the current asset SHA-1 is retained. The lack recording additionally names **Betsy Megas** in embedded artist metadata and carries the original noncanonical notice “Creative Commons BY-CA”; both are preserved alongside the explicit CC BY-SA 3.0 source-page offer, without inventing a separate legal interpretation or independently asserting an alias identity.

Examples of the exact primary pages: [Grendelkhan cat](https://commons.wikimedia.org/wiki/File:LL-Q1860_(eng)-Grendelkhan-cat.wav), [Dvortygirl cat](https://commons.wikimedia.org/wiki/File:En-us-cat.ogg), [Dvortygirl lack](https://commons.wikimedia.org/wiki/File:En-us-lack.ogg), [Dvortygirl luck](https://commons.wikimedia.org/wiki/File:En-us-luck.ogg). The local attribution records retain all twelve source pages and audited revision URLs.

Original WAV/Ogg recordings are retained privately and checked against the source file size and SHA-1. Candidate MP3s use mono, 44.1 kHz, 192 kb/s encoding. Resampling and downmix occur where needed; metadata is stripped. No trimming, denoising, pitch change, time stretch or loudness normalization was applied. Encoding does not remove background noise, recording-session differences or voice variation. Source recording dates vary across 2005–2007 for Dvortygirl and March–May 2024 for Grendelkhan. Neither source attribution nor a shared contributor name proves controlled recording conditions.

## Exact coverage gaps

The following counts are **source-identified forms found**, not acquired or phonetically approved recordings. Each contrast requires six forms per contributor.

| Contributor | /ʒ–dʒ/ | /ʊ–ʌ/ | /æ–ʌ/ |
|---|---|---|---|
| Grendelkhan | 3/6: pleasure, version, virgin | 5/6; missing putt | 6/6 |
| Dvortygirl | 3/6: pleasure, version, virgin; virgin has a conflicting source pronunciation | 3/6: put, book, luck | 6/6 |
| Wodencafe | 1/6: pleasure | 5/6; missing buck | 4/6; missing cap, lack |
| Vealhurl | 2/6: lesion, legion, labeled Southern England | 1/6: look, labeled Southern England | 3/6: cut, cup, lack |

**Pledger:** the exact Lingua Libre query and the broader Commons audio query both returned zero. The [Wiktionary entry](https://en.wiktionary.org/w/index.php?title=pledger&oldid=81091763) has no audio declaration. This does not prove no recording exists anywhere; it documents the search boundary. No other noun or invented form was substituted.

**Version/virgin:** the requested pair requires the same final schwa: `/ˈvɝʒən/` and `/ˈvɝdʒən/`. Wiktionary places the US version audio under `/ˈvɝʒən/`, but its US virgin audio is beneath GA `/ˈvɝd͡ʒɪn/`. That is an explicit conflict with the requested matched ending. It was **not acquired or offered as a matching stimulus**. Source context is not itself an acoustic judgment, but it is sufficient to prevent automatic acceptance. [Version revision](https://en.wiktionary.org/w/index.php?title=version&oldid=92757418), [virgin revision](https://en.wiktionary.org/w/index.php?title=virgin&oldid=92505318).

**Put/putt and book/buck:** no second complete matching contributor set was found. The broader putt query found Wodencafe’s isolated word, an Australian recording and a US recording explicitly of [“putt from the rough”](https://commons.wikimedia.org/wiki/File:En-us-putt_from_the_rough.oga). The phrase was not downloaded, cropped or relabeled as an isolated word. Wodencafe lacks buck in the bounded search; Grendelkhan lacks putt. Combining their files under one speaker ID would fabricate a matched profile and was not done.

**Look:** alternate US files exist, including [En-us-look (3)](https://commons.wikimedia.org/wiki/File:En-us-look_(3).ogg), whose upload comment credits Dsm.wiki. That does not fill a missing Dvortygirl file. No contributor identities were merged to make coverage appear complete.

## Search and evidence boundary

The search covered all 17 exact Lingua Libre English forms, a batch of the 17 conventional `En-us-<word>.ogg` titles, current Wiktionary audio declarations for all 17 entries, metadata for 28 relevant Lingua Libre files, five broader Commons audio searches, four targeted alternate-title checks, Commons MediaInfo transcriptions and public contributor profiles. All exact Lingua Libre queries were below their 100-result cap. The broader look query had 103 total hits and retained the first 100; other broader queries were below the cap. Missing-in-search is kept distinct from nonexistent.

Two HTTP429 events were recorded and respected: an early short API cooldown and a later 600-second media cooldown before the final luck recording. No credentials, paid services, correspondence, human voice cloning or host-switch workaround was used.

## Recommendation

1. Keep this isolated candidate for listening review. Check the complete /æ–ʌ/ set for the actual target vowels, intact consonants, same-profile consistency and General American suitability, especially Grendelkhan’s regional realization. It is not ready for a validated/native-accent claim merely because decoding passed.
2. Keep the other two contrasts explicitly unavailable in any human-only mode until matched coverage exists. Do not replace pledger, crop a phrase, mix contributor IDs or accept the conflicting virgin variant to fill the UI.
3. If full coverage is required soon, original recordings from appropriately fluent contributors with documented reuse permission are the cleanest way to fill these exact gaps. An owner-provided recording set can avoid a cash fee if the speaker and target dialect are suitable. This is a recommendation only: no person has been contacted and no outreach drafted.

Fixed-speaker synthetic comparisons remain separate. This task provides no evidence that one audio source teaches better, no listener learning results and no completed phonetic review.

## Artifacts

- [Candidate manifest](../rescue/audio/human-english-expansion/manifest.candidate.json) — issued only after all twelve are acquired.
- [Attribution](../rescue/audio/human-english-expansion/attribution.json) — per-file creator, source/revision, license and changes.
- [Independent checks](../rescue/audio/human-english-expansion/verification.json).
- [Exact source/coverage audit](../rescue/audio/human-english-expansion/source-coverage-audit.json).
- [Unfilled listening worksheet](../rescue/audio/human-english-expansion/listening-review.template.json).

The source snapshots and originals are research/private material, not a public bundle. The acquisition scripts write only inside `rescue/audio/human-english-expansion/`; this report is the only additional research output. No application files or default manifests were modified.
'''
path=BASE.parent.parent.parent/'research/human-english-expansion-2026-09-28.md';path.write_text(report)
readme=f'''# Human English expansion candidate

{status}

{stats}

Scope: **cat/cut, cap/cup, lack/luck**. Contributors: Grendelkhan (CC0) and Dvortygirl (CC BY-SA 3.0). Each source’s license and attribution stays separate. Only Dvortygirl has explicit US/GA source evidence; Grendelkhan’s regional accent is unestablished. All audio is **source-verified-unreviewed**, not pronunciation-approved.

The /ʒ–dʒ/ and /ʊ–ʌ/ requests remain incomplete. The conflicting source pronunciation of virgin, absent pledger, unmatched contributor coverage and phrase-only US putt alternative are documented in `source-coverage-audit.json` and the [focused report](../../../research/human-english-expansion-2026-09-28.md).

`manifest.candidate.json` and `attribution.json` are produced only upon complete acquisition. `verification.json` records independent engineering checks. `listening-review.template.json` contains no prefilled approval. `private/originals/` preserves originals; `sources/` preserves research snapshots. Neither should be copied into the public app. MP3s are in `clips/`. No app or default manifest is changed.

The source file size/SHA-1 and output SHA-256 are checked. Output: 44.1 kHz mono 192 kb/s MP3, resampling/downmix where needed, metadata stripped; no trimming, denoising, pitch/time alteration or loudness normalization. Encoding does not validate the phonetics or eliminate source-session differences.

From the workspace, use the existing audio environment:

```sh
rescue/audio/.venv/bin/python rescue/audio/human-english-expansion/discover.py
rescue/audio/.venv/bin/python rescue/audio/human-english-expansion/acquire.py
rescue/audio/.venv/bin/python rescue/audio/human-english-expansion/verify.py
rescue/audio/.venv/bin/python rescue/audio/human-english-expansion/audit_sources.py
rescue/audio/.venv/bin/python rescue/audio/human-english-expansion/write_report.py
```

Downloads resume from checked originals. Any Wikimedia Retry-After stops requests; the deadline is recorded in `private/retry-not-before.json` and honored across the audio research directories. No alternate host is used to bypass it.
'''
(BASE/'README.md').write_text(readme)
print(json.dumps({'report':str(path),'complete':complete,'actualClips':len(clips)}))
