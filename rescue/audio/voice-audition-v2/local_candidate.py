#!/usr/bin/env python3
"""Bounded offline CustomVoice audition. Dry-run unless --execute is supplied.

Each word uses a documented fixed preset, never per-word VoiceDesign. Technical
checks and ASR are screening only; no clip is automatically pronunciation-approved.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import time

HERE = Path(__file__).resolve().parent
REPO = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit"
REVISION = "f35faf19b0cc2160865af64ecf0f22f83d335135"
PRESETS = ("Vivian", "Uncle_Fu")
SETTINGS = dict(temperature=0.7, top_p=0.9, top_k=50,
                repetition_penalty=1.05, max_tokens=128, instruct=None,
                language="Chinese", verbose=False, stream=False)
REPAIR_INSTRUCTION = "用标准普通话，以自然、平静的语气清晰读出所给的单个汉字，只读一次，不添加其他内容。"
LIMITATIONS = [
    "Fixed preset identity does not certify accent, tone, pronunciation, or perceived speaker consistency.",
    "Single-character words are difficult TTS inputs; no pronunciation is automatically approved.",
    "Technical metrics and independent ASR are triage, not native-speaker or phonetic validation.",
    "MLX community 4-bit conversion of Apache-2.0 Qwen weights; not the official unquantized runtime.",
]


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def load_words(path):
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict) and "lexicalItems" in data:
        ids = data.get("audition", {}).get("wordIds", [])
        if not ids or len(ids) != len(set(ids)):
            raise ValueError("audition.wordIds must be a nonempty unique selection")
        rows = data["lexicalItems"]
        if isinstance(rows, dict):
            rows = [dict(value, id=key) for key, value in rows.items()]
        indexed = {row.get("wordId", row.get("id")): row for row in rows}
        if len(indexed) != len(rows) or any(item not in indexed for item in ids):
            raise ValueError("duplicate or missing lexical item id")
        rows = [indexed[item] for item in ids]
    else:
        rows = data if isinstance(data, list) else data.get("words", data.get("items", []))
    if not 1 <= len(rows) <= 32:
        raise ValueError("audition must contain 1–32 words")
    result = []
    for row in rows:
        if row.get("split", "train") != "train":
            raise ValueError("heldout assessment words must not be auditioned")
        item = {
            "wordId": row.get("wordId", row.get("id")),
            "bankId": row.get("bankId", "zh"),
            "languageId": row.get("languageId", "zh"),
            "text": row.get("text"),
            "reading": row.get("reading", row.get("romanization")),
            "ipa": row.get("ipa"),
            "meaning": row.get("meaning"),
        }
        if any(not isinstance(value, str) or not value.strip() for value in item.values()):
            raise ValueError("every selected word requires identity, spelling, reading, IPA, and meaning")
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", item["wordId"]):
            raise ValueError("invalid word id")
        if item["languageId"] != "zh" or item["bankId"] != "zh":
            raise ValueError("this bounded adapter supports only the Mandarin audition")
        if len(item["text"]) > 8 or any(c in item["text"] for c in "\r\n"):
            raise ValueError("audition input must be a short word")
        result.append(item)
    if len({row["wordId"] for row in result}) != len(result):
        raise ValueError("duplicate selected word id")
    return result


def validate_model(model_dir):
    folder = Path(model_dir).resolve(strict=True)
    config = json.loads((folder / "config.json").read_text())
    provenance = json.loads((folder / "provenance.json").read_text())
    if config.get("tts_model_type") != "custom_voice":
        raise ValueError("per-word VoiceDesign and unconditioned Base generation are not allowed")
    if provenance.get("repo") != REPO or provenance.get("revision") != REVISION:
        raise ValueError("model must match the pinned CustomVoice download")
    speakers = config.get("talker_config", {}).get("spk_id", {})
    if any(speaker.lower() not in speakers for speaker in PRESETS):
        raise ValueError("documented Mandarin presets missing")
    return folder


def plan_clips(words, url_prefix, repair_from=None):
    if not url_prefix.startswith("/") or ".." in url_prefix or ":" in url_prefix:
        raise ValueError("URL prefix must be an application-relative path")
    clips = []
    repair_index = {}
    if repair_from is not None:
        if repair_from.get("status") != "complete" or repair_from.get("repairOf"):
            raise ValueError("repair requires one completed original run, never another repair")
        if repair_from.get("modelRevision") != REVISION:
            raise ValueError("repair source must use the same pinned model")
        repair_index = {(clip["wordId"], clip["speaker"]): clip for clip in repair_from["clips"]
                        if clip["technicalStatus"] == "needs-review"}
        if not repair_index:
            raise ValueError("no technically flagged clips to repair")
    settings = dict(SETTINGS)
    if repair_from is not None:
        settings["instruct"] = REPAIR_INSTRUCTION
    for word in words:
        for speaker in PRESETS:
            previous = repair_index.get((word["wordId"], speaker))
            if repair_from is not None and previous is None:
                continue
            if previous and any(previous[key] != value for key, value in word.items()):
                raise ValueError("repair word metadata changed from the original audition")
            take = 2 if previous else 1
            profile = dict(provider="qwen-local-mlx", model=REPO, revision=REVISION,
                           speaker=speaker, settings=settings)
            voice_id = "qwen-cv-zh-" + speaker.lower().replace("_", "-") + "-" + digest(profile)[:10]
            # Seed varies independently of the expected phonetic category and meaning.
            seed = int(digest({"wordId": word["wordId"], "speaker": speaker, "take": take})[:8], 16)
            identity = dict(word=word, voiceId=voice_id, seed=seed, take=take)
            synthesis_text = word["text"] + ("。" if previous else "")
            if previous:
                identity["synthesisText"] = synthesis_text
            clip_id = f"{word['wordId']}-{speaker.lower()}-{digest(identity)[:12]}"
            clips.append({**word, "id": clip_id, "provider": "qwen-local-mlx", "model": REPO,
                          "modelRevision": REVISION, "voiceId": voice_id, "speaker": speaker,
                          "locale": "cmn-CN", "language": "Chinese", "seed": seed, "take": take,
                          "synthesisText": synthesis_text,
                          "url": f"{url_prefix.rstrip('/')}/{clip_id}.wav", "sha256": None,
                          "technicalStatus": "pending", "reviewStatus": "pending",
                          "generationSettings": dict(settings),
                          **({"repairOfClipId": previous["id"], "repairOfSha256": previous["sha256"]} if previous else {})})
    if repair_from is not None and len(clips) != len(repair_index):
        raise ValueError("word selection no longer contains every flagged original clip")
    return clips


def model_kwargs(clip):
    # No expected reading/IPA/meaning is supplied as an answer hint.
    return {"text": clip.get("synthesisText", clip["text"]), "speaker": clip["speaker"], **clip["generationSettings"]}


def save_json(path, data):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def render_clip(model, clip, destination, mx, np, sf):
    started = time.monotonic()
    mx.random.seed(clip["seed"])
    pieces = list(model.generate_custom_voice(**model_kwargs(clip)))
    if not pieces:
        raise ValueError("model_returned_no_audio")
    rates = {part.sample_rate for part in pieces}
    if len(rates) != 1:
        raise ValueError("inconsistent_sample_rate")
    sample_rate = int(rates.pop())
    samples = np.concatenate([np.asarray(part.audio).reshape(-1) for part in pieces]).astype(np.float32)
    if not samples.size or not np.isfinite(samples).all() or sample_rate < 8000:
        raise ValueError("empty_or_invalid_audio")
    token_count = sum(int(part.token_count) for part in pieces)
    duration = samples.size / sample_rate
    peak = float(np.abs(samples).max())
    rms = float(np.sqrt(np.mean(samples ** 2)))
    flags = []
    if duration < 0.15: flags.append("very_short")
    if duration > 4.0: flags.append("long_for_isolated_word")
    if rms < 0.003: flags.append("near_silent")
    if peak > 1.0: flags.append("peak_above_full_scale")
    if token_count >= clip["generationSettings"]["max_tokens"]: flags.append("token_cap_reached")
    # FLOAT preserves the generated signal; no cropping, rate change, or normalization.
    sf.write(destination, samples, sample_rate, subtype="FLOAT")
    clip.update(sha256=hashlib.sha256(destination.read_bytes()).hexdigest(),
                technicalStatus="needs-review" if flags else "pass", technicalFlags=flags,
                metrics={"durationSeconds": round(duration, 6), "sampleRate": sample_rate,
                         "peak": peak, "rms": rms, "tokenCount": token_count,
                         "generationSeconds": round(time.monotonic() - started, 3)},
                fileName=destination.name)
    mx.clear_cache()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wordset", type=Path, required=True)
    parser.add_argument("--model", type=Path, default=HERE / "models/qwen-customvoice-1.7b-4bit")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--url-prefix", required=True)
    parser.add_argument("--repair-from", type=Path, help="one bounded second pass for original technical warnings only")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    words = load_words(args.wordset)
    folder = validate_model(args.model)
    repair_from = json.loads(args.repair_from.read_text()) if args.repair_from else None
    clips = plan_clips(words, args.url_prefix, repair_from)
    output = args.output.resolve()
    if not output.is_relative_to(HERE / "runs") or output == HERE / "runs":
        parser.error("output must be a new directory inside this adapter's ignored runs directory")
    if output.exists():
        parser.error("output already exists; existing audition files are never overwritten")
    source_data = json.loads(args.wordset.read_text())
    report = {"schemaVersion": 1, "id": output.name,
              "textBankId": source_data.get("basedOnRelease", "mandarin-balance-draft") if isinstance(source_data, dict) else "mandarin-balance-draft",
              "purpose": "Independent audition of fixed synthetic Mandarin presets; not approved learner audio.",
              "providerNotes": LIMITATIONS,
              "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
              "provider": "qwen-local-mlx", "model": REPO, "modelRevision": REVISION,
              "wordsetSha256": hashlib.sha256(args.wordset.read_bytes()).hexdigest(),
              "status": "planned", "limitations": LIMITATIONS, "clips": clips}
    if args.repair_from:
        report["repairOf"] = {"id": repair_from["id"], "manifestSha256": hashlib.sha256(args.repair_from.read_bytes()).hexdigest(),
                              "scope": "Only technically flagged original clips; exactly one second take, with neutral Putonghua instruction and terminal punctuation. Originals retained."}
    if not args.execute:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_audio.tts.utils import load_model
    output.mkdir(parents=True, exist_ok=False)
    (output / "clips").mkdir()
    save_json(output / "manifest.json", report)
    started = time.monotonic()
    model = load_model(str(folder))
    if model.config.tts_model_type != "custom_voice":
        raise ValueError("loaded model is not CustomVoice")
    report["status"] = "running"
    for index, clip in enumerate(clips):
        try:
            render_clip(model, clip, output / "clips" / f"{clip['id']}.wav", mx, np, sf)
        except Exception as exc:
            clip.update(technicalStatus="failed", technicalFlags=[type(exc).__name__ + ": " + str(exc)[:200]])
        save_json(output / "manifest.json", report)
        print(json.dumps({"progress": index + 1, "total": len(clips), "id": clip["id"],
                          "technicalStatus": clip["technicalStatus"], "metrics": clip.get("metrics")}), flush=True)
    report.update(status="complete", elapsedSeconds=round(time.monotonic() - started, 3))
    save_json(output / "manifest.json", report)
    print(json.dumps({"manifest": str(output / "manifest.json"), "clips": len(clips),
                      "files": sum(bool(c["sha256"]) for c in clips), "elapsedSeconds": report["elapsedSeconds"]}))


if __name__ == "__main__":
    main()
