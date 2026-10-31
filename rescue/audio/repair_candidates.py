#!/usr/bin/env python3
"""Quarantine abnormally long isolated-word Qwen candidates and retry bounded seeds.

This is an engineering filter, not a pronunciation validator. All accepted replacements
remain generated-unreviewed, and every rejected candidate's metadata is retained.
"""
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import time

from audio_cache import (HERE, DEFAULT_OUTPUT, QwenGenerator, atomic_json, digest,
                         encode_mp3, generation_settings, now, read_items, voice_for)


def main():
    with (HERE / ".cache-generation.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        manifest_path = DEFAULT_OUTPUT / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        targets = {(i["languageId"], i["text"]): i
                   for i in read_items(HERE.parent / "content/curriculum.json")}
        bad = [c for c in manifest["clips"] if c["provider"] == "qwen" and
               (c.get("durationSeconds", 0) > 3 or c.get("generationTokenCount", 0) >= 180)]
        print(f"{len(bad)} abnormally long candidates to replace", flush=True)
        if not bad:
            return
        rejected_dir = HERE / "rejected"
        rejected_dir.mkdir(exist_ok=True)
        rejected_path = rejected_dir / "manifest.json"
        rejected = json.loads(rejected_path.read_text()) if rejected_path.exists() else []
        bad_ids = {c["id"] for c in bad}
        manifest["clips"] = [c for c in manifest["clips"] if c["id"] not in bad_ids]
        # Remove rejected entries before working on replacements; never serve failures as ready.
        atomic_json(manifest_path, manifest)
        for old in bad:
            old["status"] = "rejected"
            old["rejectionReason"] = "Exceeds conservative 3-second isolated-word duration cap or reaches token cap"
            rejected.append(old)
            source = DEFAULT_OUTPUT / "clips" / Path(old["url"]).name
            if source.exists():
                shutil.move(source, rejected_dir / source.name)
        atomic_json(rejected_path, rejected)
        overrides_path = HERE / "generation-overrides.json"
        overrides = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
        model = QwenGenerator()
        failed = []
        for old in bad:
            item = targets[(old["languageId"], old["text"])]
            slot = old["voiceId"].rsplit("-", 1)[1]
            voice = voice_for("qwen", item["languageId"], slot)
            success = False
            for attempt, seed in enumerate((4919, 5471, 7727, 9901), 1):
                seed += 1 if slot == "b" else 0
                settings = generation_settings("qwen", item, voice, seed)
                clip_id = digest(settings)
                started = time.monotonic()
                with tempfile.TemporaryDirectory() as temporary:
                    wav = Path(temporary) / "candidate.wav"
                    metrics = model.generate(item, voice, wav, seed)
                    mp3 = Path(temporary) / "candidate.mp3"
                    encode_mp3(wav, mp3)
                    data = mp3.read_bytes()
                    record = {**old, **metrics, "id": clip_id,
                              "url": "/audio/clips/" + clip_id + ".mp3",
                              "status": "generated-unreviewed", "createdAt": now(),
                              "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                              "generationSeconds": round(time.monotonic() - started, 3),
                              "replacesRejectedCandidate": old["id"], "generationAttempt": attempt}
                    record.pop("rejectionReason", None)
                    if metrics["durationSeconds"] > 3 or metrics["generationTokenCount"] >= 180 or metrics["peakBeforeAdjustment"] < 0.005:
                        record.update({"status": "rejected", "rejectionReason": "Duration/token/silence engineering filter"})
                        rejected.append(record)
                        (rejected_dir / (clip_id + ".mp3")).write_bytes(data)
                        atomic_json(rejected_path, rejected)
                        print(f"Retry {attempt} rejected: {item['languageId']} {item['text']} {slot} {metrics['durationSeconds']}s", flush=True)
                        continue
                    (DEFAULT_OUTPUT / "clips" / (clip_id + ".mp3")).write_bytes(data)
                manifest["clips"].append(record)
                manifest["updatedAt"] = now()
                atomic_json(manifest_path, manifest)
                overrides[f"{item['languageId']}:{item['text']}:{slot}"] = {
                    "seed": seed, "reason": "Original exceeded isolated-word duration cap",
                    "rejectedCandidateId": old["id"], "selectedCandidateId": clip_id}
                atomic_json(overrides_path, overrides)
                print(f"Replaced: {item['languageId']} {item['text']} {slot} {metrics['durationSeconds']}s", flush=True)
                success = True
                break
            if not success:
                failed.append({"languageId": item["languageId"], "text": item["text"], "voiceId": old["voiceId"]})
        atomic_json(HERE / "repair-report.json", {"startedCandidates":len(bad), "unresolved":failed,
                    "rejectedTotal":len(rejected), "allReplacementsUnreviewed":True})
        if failed:
            raise SystemExit(f"Unresolved candidates: {failed}")


if __name__ == "__main__":
    main()
