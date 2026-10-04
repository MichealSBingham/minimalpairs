# Local audio studio

Double-click **Start Audio Studio.command** on this Mac. No agent, API key, subscription or per-word API fee is needed for Chatterbox. The installed MLX model uses the Mac GPU.

1. Run the four-recording test.
2. Generate the 32-recording audition and listen.
3. When satisfied, choose the complete American English bank: 250 recording units × 2 voices = 500 recordings. The runner reuses completed, checksum-matching recordings.
4. Open the listening page. It also shows words, IPA, meanings, contrast memberships and pronunciation warnings. Uncheck “With recordings” to inspect the entire word bank. Browser reviews can be exported.

The database is `private/audio.sqlite3`; WAV files are in `private/clips`. Every new recording enters the database as **unreviewed**. It is not automatically published into live practice. Keep this folder as a backup. The runner does not retry interrupted or failed attempts automatically, to avoid overwriting evidence; these currently require investigation before resuming that exact job.

## Scope and limitations

The frozen text-bank-v2 import contains 1,198 unique bank/text/IPA/reading recording units, including 250 American and 174 British English units. Meanings and contrast memberships remain attached. Reserved assessment material is excluded. Homophones within a bank and alternate dictionary readings are flagged, not deleted. CMUdict screens English; British results are provisional because that dictionary describes US English. Other languages have within-bank checks only, and explicitly show that external screening remains pending. Dictionary variants are review hints, not proof of an error.

Chatterbox currently has two fixed synthetic English reference voices. They are distinct references, but their native accent, naturalness and phoneme accuracy have **not** been verified by human listening. No real person's voice is cloned. British and other-language generation is blocked until suitable reference voices are configured. A language code alone does not establish the right accent. Increasing random seeds would not establish additional speakers.

Signal checks detect silence, duration outliers and possible clipping; they do not establish correct pronunciation. Human review is still necessary. Model and tokenizer revisions, reference checksums, settings and intended IPA are stored with each recording. Speech receives the written word, not IPA; ambiguous words therefore need special attention.

Cartesia passed an eight-clip live synthesis test (book/buck in four catalog-native American voices) on 2026-10-01. Menu options 6 and 7 run its comparison and audition. Its key is stored only in the ignored private credentials file with owner-only permissions. Google remains untested and is not exposed in the menu. Google uses the existing shared $1 authorization ledger; Cartesia has a small private-evaluation character cap. No cloud generation is needed or started by this launcher.

## Sources

English warning dictionary: https://github.com/cmusphinx/cmudict (downloaded 2026-10-01; license in sources/CMUDICT-LICENSE). Dictionary warnings do not replace the bank's intended IPA.

Chatterbox model: mlx-community/chatterbox-multilingual-v3, revision 03565773edd72e949572557597af8063bb49a18a. Tokenizer: mlx-community/S3TokenizerV2, revision e0c9886f0e1c35ae85b1f27277416fb19fc72bec. This runner uses the existing installed snapshots and references on this Mac; it is not a clean-machine installer.

## Four-voice US English batch

Audition C and D at http://127.0.0.1:63119/?voices=new before running `bash run-english.sh`. The batch now targets 250 words × four voices = 1,000 clips, reusing completed A/B recordings and the C/D audition. Additional voices are fictional fixed reference profiles created locally with Qwen VoiceDesign, then rendered by Chatterbox. Their accent and quality remain unreviewed until you listen. The script saves logs, prevents idle sleep, and verifies all target files on completion. No Cartesia calls are made.
