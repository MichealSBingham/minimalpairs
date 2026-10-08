# Approved US Voice A replacement

Candidate F was approved by the owner. This replaces the speaker in slot A, not French A. The full bank has 250 word/IPA units; 241 old A recordings were live at preparation. The new IDs and hashes preserve separation from all old rejections and approvals.

## Local generation (no API or token costs)

From the repository root:

```sh
rescue/audio/.venv/bin/python rescue/audio/studio/replace_us_voice_a.py --execute
```

Resume the same command after interruption. Completed hashes are checked and reused. A lock prevents two generation processes. The running launch uses caffeinate to prevent idle sleep; the Mac still must remain powered on. Four bounded attempts per word run duration, silence, clipping and repeated-burst screening. Flagged candidates stay out of the staged manifest. Technical success does not certify pronunciation.

Cheap status check:

```sh
rescue/audio/.venv/bin/python rescue/audio/studio/replace_us_voice_a.py --verify
```

Run directory: `private/voice-replacements/us-a-v2-candidate-f-4fdb19a2ec99` under this directory. `run.log`, `summary.json`, per-word `results`, and immutable `renders` are the evidence. Needs-review words can get another bounded pass with `--execute --retry-flagged`; inspect persistent failures instead of repeating indefinitely.

## Final integration and deployment

After all 250 are complete, run the dry check:

```sh
rescue/audio/.venv/bin/python rescue/audio/studio/promote_us_voice_a.py
```

This requires every new render to pass the generation checks, all hashes intact, the source manifest unchanged, at least two speakers per word, and a shared speaker for each A/B reference pair. If the live manifest changed during generation, reconcile rather than overwriting recent exclusions. It never replaces a rejected render with the same ID/hash or marks new clips human-approved.

Then integrate locally:

```sh
rescue/audio/.venv/bin/python rescue/audio/studio/promote_us_voice_a.py --execute
```

This preserves rejected database rows, supersedes only complete old A rows, retains all old reference/audio files, writes new clip IDs and hash-versioned public filenames, and changes the future generation reference through `private/us-active-reference-overrides.json`. `before-promotion/` contains the immediate rollback manifest/database/previous override. No hosting deployment occurs in this command.

Run the existing application audio coverage/build checks and the usual production deployment (`node scripts/deploy-preview.mjs --production` from `rescue/app`). Verify deployed manifest/hash and representative audio URLs afterward. Re-scan local QA to include the new clips; retain all prior hash-bound review decisions. The chosen speaker needs no second approval; persistent anomalous word renders can be presented individually. Never label all generated clips human-reviewed.

If promotion fails partway, do not delete old recordings. Inspect the saved pre-promotion state and finish or restore atomically before deploying. Database insertions are additive and repeat-safe; old files remain for rollback.

## Second-layer audit of the replacement hashes

Generation checks repeated waveform bursts and signal metrics; it does not transcribe. After local integration, run the existing hash-cached second layer:

```sh
rescue/audio/.venv/bin/python rescue/audio/studio/audit_layer2.py --model medium
```

This reuses existing results and transcribes only new hashes using cached Whisper medium on the CPU. Candidate F started with exactly 250 uncached recordings and 3,222 cached others. The report is `private/layer2-report.json`; completion requires `complete: true`, all 250 new clip IDs with current hashes, and no audit errors. ASR mismatches and low confidence are triage signals, not pronunciation failures. Confirmed repeated words can be separately quarantined, with coverage checked; no result automatically becomes human-approved. The three peer-duration outliers already quarantined remain excluded regardless of transcription results.
