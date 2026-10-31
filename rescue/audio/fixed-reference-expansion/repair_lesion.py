#!/usr/bin/env python3
"""One separately authorized punctuation hypothesis; at most two attempts."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, time
import generate as g

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    here = g.HERE
    prior = g.read(here / 'run-summary.json')
    clips = g.read(here / 'inventory.private.json')['clips']
    ref = next(r for r in g.read(here / 'references.json')['references'] if r['profileKey'] == 'en-b')
    existing = [c for c in clips if c['text'] == 'lesion' and c['voiceId'] == ref['voiceId']]
    if existing:
        print('Requested mapping already exists; no generation.'); return
    if (here / 'repair-lesion-result.json').exists():
        raise SystemExit('Bounded repair already attempted; inspect its result. No automatic retries.')
    print(json.dumps({'text': 'lesion', 'ttsText': 'Lesion.', 'maxAttempts': 2, 'voiceId': ref['voiceId'], 'execute': args.execute}))
    if not args.execute:
        return
    for line in subprocess.check_output(['ps', '-axo', 'pid,command'], text=True).splitlines():
        if any(token in line for token in ['audio_cache.py', 'run_pilot.py', 'mlx_audio.tts.generate', 'fixed-reference-expansion/generate.py', 'fixed-reference-expansion/repair_lesion.py']):
            pid = int(line.strip().split(maxsplit=1)[0])
            if pid not in {os.getpid(), os.getppid()}:
                raise RuntimeError(f'Another synthesis-related process exists: {pid}')
    checkpoint = here / 'private/pre-lesion-punctuation-repair'
    checkpoint.mkdir(exist_ok=True)
    for name in ['run-summary.json', 'verification.json', 'manifest.candidate.json', 'manifest.preview.json', 'integration-inventory.json']:
        shutil.copyfile(here / name, checkpoint / name)
    # Commit the two-attempt limit to disk before any model call.
    record = {'hypothesis': 'Capitalization and sentence punctuation may prevent immediate EOS while intended spoken content remains lesion.', 'originalTtsText': 'lesion', 'ttsText': 'Lesion.', 'voiceId': ref['voiceId'], 'referenceSha256': ref['referenceSha256'], 'maxAttempts': 2, 'startedAt': g.now(), 'attempts': [], 'completed': False, 'accepted': False}
    g.write(here / 'repair-lesion-result.json', record)
    from huggingface_hub import snapshot_download
    import mlx.core as mx, numpy as np, soundfile as sf
    from mlx_audio.tts.utils import load_model
    from mlx_audio.utils import load_audio
    started = time.perf_counter()
    model = load_model(snapshot_download(g.MODEL, revision=g.REVISION, local_files_only=True))
    wav = here / ref['privateWavPath']
    assert g.sha(wav) == ref['referenceSha256']
    embedding = model.extract_speaker_embedding(load_audio(str(wav), sample_rate=model.sample_rate))
    embedding_hash = g.hashed(np.asarray(embedding, dtype=np.float32).tobytes())
    assert embedding_hash == ref['baseSpeakerEmbeddingSha256']
    scoped = g.read(here / 'scope-snapshot.json')
    word = next(w for w in scoped['words']['en'] if w['text'] == 'lesion')
    for attempt in range(2):
        seed = 2320000 + attempt
        settings = {'model': g.MODEL, 'modelRevision': g.REVISION, 'language': 'English', 'text': 'Lesion.', 'intendedWord': 'lesion', 'referenceSha256': ref['referenceSha256'], 'referenceTextSha256': ref['referenceTextSha256'], 'seed': seed, 'take': 0, 'attempt': attempt, 'attemptSeries': 'lesion-capitalization-punctuation-repair', 'temperature': .65, 'topP': .9, 'topK': 50, 'repetitionPenaltyRequested': 1.05, 'effectiveICLRepetitionPenalty': 1.5, 'maxTokens': 60, 'runtimeVersions': prior['runtimeVersions'], 'encoding': '192k-mp3-original-24000hz-mono'}
        cid = g.hashed(json.dumps(settings, sort_keys=True, ensure_ascii=False).encode())[:28]
        original = here / 'private/originals' / f'{cid}.wav'
        mx.random.seed(seed); tick = time.perf_counter()
        out = list(model.generate(text='Lesion.', lang_code='english', ref_audio=str(wav), ref_text=ref['referenceText'], temperature=.65, top_p=.9, top_k=50, repetition_penalty=1.05, max_tokens=60, verbose=False, stream=False))
        elapsed = time.perf_counter() - tick
        attempt_record = {'voiceId': ref['voiceId'], 'text': 'lesion', 'ttsText': 'Lesion.', 'seed': seed, 'attempt': attempt, 'attemptSeries': settings['attemptSeries'], 'generationSeconds': elapsed}
        reasons = []
        if not out:
            reasons = ['No waveform returned (immediate EOS)']
        else:
            data = np.concatenate([np.asarray(p.audio, dtype=np.float32) for p in out])
            rate = int(out[0].sample_rate); tokens = sum(p.token_count for p in out)
            if not len(data) or not np.isfinite(data).all():
                reasons = ['Empty or non-finite waveform']
            else:
                duration = len(data) / rate; peak = float(np.max(np.abs(data)))
                scale = min(1., .98 / peak) if peak else 1.
                rms = float(np.sqrt(np.mean(data.astype(np.float64) ** 2)))
                sf.write(original, data * scale, rate, subtype='PCM_16')
                attempt_record.update({'durationSeconds': duration, 'tokenCount': tokens})
                if not .16 <= duration <= 3.2: reasons.append('Duration outside0.16–3.2 seconds')
                if tokens >= 60: reasons.append('Generation token cap reached')
                if rms < .00005: reasons.append('Near-silent waveform')
        attempt_record.update({'acceptedEngineering': not reasons, 'reasons': reasons})
        record['attempts'].append(attempt_record)
        g.write(here / 'repair-lesion-result.json', record)
        g.event(stage='lesion-punctuation-repair', **attempt_record)
        if reasons:
            if original.exists(): original.rename(here / 'private/rejected' / original.name)
            continue
        output = here / 'clips' / f'{cid}.mp3'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(original), '-map_metadata', '-1', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '192k', str(output)], check=True)
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(output), '-f', 'null', '-'], check=True, stdout=subprocess.DEVNULL)
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'stream=sample_rate,channels:format=duration', '-of', 'json', str(output)], text=True))
        encoded_duration = float(probe['format']['duration'])
        assert abs(encoded_duration - duration) < .15
        c = {'id': cid, 'languageId': 'en', 'voiceId': ref['voiceId'], **word, 'ttsText': 'Lesion.', 'ttsInputChange': 'Capitalization and sentence punctuation only; intended spoken word unchanged. Actual word remains unreviewed.', 'take': 0, 'url': f'/audio/fixed-reference-expansion/clips/{cid}.mp3', 'status': 'generated-unreviewed', 'provider': 'qwen-base-fixed-reference', 'synthetic': True, 'phoneticListeningVerified': False, 'speakerConsistencyVerified': False, 'assessmentApproved': False, 'intendedLocale': ref['intendedLocale'], 'intendedDialect': ref['intendedDialect'], 'conditioningMechanism': g.CONDITIONING, 'referenceSha256': ref['referenceSha256'], 'referenceTextSha256': ref['referenceTextSha256'], 'baseSpeakerEmbeddingSha256': embedding_hash, 'referenceProvenance': ref['provenance'], 'referenceRemoval': 'MLX Base ICL removes its decoded reference prefix internally; no additional word trimming applied', 'privateReferencePath': ref['privateWavPath'], 'privateWavPath': str(original.relative_to(here)), 'model': g.MODEL, 'modelRevision': g.REVISION, 'modelLicense': 'Apache-2.0', 'modelLicenseUrl': f'https://huggingface.co/{g.MODEL}/blob/{g.REVISION}/README.md', 'generationSettings': settings, 'sha256': g.sha(output), 'sourceWavSha256': g.sha(original), 'bytes': output.stat().st_size, 'durationSeconds': duration, 'encodedDurationSeconds': encoded_duration, 'sampleRate': rate, 'channels': 1, 'samples': len(data), 'peakBeforeAdjustment': peak, 'peakScale': scale, 'rmsBeforeAdjustment': rms, 'generationTokenCount': tokens, 'maxTokens': 60, 'generationSeconds': elapsed, 'createdAt': g.now()}
        clips.append(c); record['accepted'] = True; record['clipId'] = cid
        g.write(here / 'inventory.private.json', {'clips': clips})
        break
    record.update({'completed': True, 'completedAt': g.now(), 'elapsedSeconds': time.perf_counter() - started})
    g.write(here / 'repair-lesion-result.json', record)
    refs = g.read(here / 'references.json')['references']
    manifest = g.metadata_manifest(clips, refs, scoped)
    g.write(here / 'manifest.candidate.json', manifest)
    public = json.loads(json.dumps(manifest))
    for c in public['clips']:
        c.pop('privateReferencePath', None); c.pop('privateWavPath', None)
    g.write(here / 'manifest.preview.json', public)
    inventory = {'collectionId': 'fixed-reference-expansion-v1', 'status': 'isolated-unreviewed-candidate', 'total': len(clips), 'eligibleContrasts': manifest['eligibleContrasts'], 'files': [{'path': 'clips/' + pathlib.Path(c['url']).name, 'url': c['url'], 'languageId': c['languageId'], 'text': c['text'], 'voiceId': c['voiceId'], 'sha256': c['sha256'], 'bytes': c['bytes']} for c in clips], 'excluded': ['private/', 'raw reference WAVs', 'rejected files', 'inventory.private.json', 'manifest.candidate.json'], 'defaultReplacementApproved': False}
    g.write(here / 'integration-inventory.json', inventory)
    prior.update({'initialBatchElapsedSeconds': prior['elapsedSeconds'], 'repairElapsedSeconds': record['elapsedSeconds'], 'elapsedSeconds': prior['elapsedSeconds'] + record['elapsedSeconds'], 'elapsedNote': 'Sum of measured initial and repair invocations; excludes time between them.', 'completedAt': g.now(), 'clipCount': len(clips), 'bytes': sum(c['bytes'] for c in clips), 'allAttempts': prior['attemptsThisInvocation'] + record['attempts'], 'attemptsThisInvocation': record['attempts'], 'unavailable': [] if record['accepted'] else prior['unavailable'], 'repairResult': 'repair-lesion-result.json'})
    g.write(here / 'run-summary.json', prior)
    print(json.dumps({'accepted': record['accepted'], 'clipCount': len(clips), 'attempts': len(record['attempts']), 'elapsedSeconds': record['elapsedSeconds']}))
    raise SystemExit(0 if record['accepted'] else 2)

if __name__ == '__main__':
    main()
