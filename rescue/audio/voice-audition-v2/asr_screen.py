#!/usr/bin/env python3
"""Blind local ASR screen; never supplies the expected word to the recognizer.

Run using the existing fwhisper environment. Transcription is a lexical screen,
not a test of exact phoneme, tone, naturalness, or voice identity.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import time
import unicodedata

HERE = Path(__file__).resolve().parent
DEFAULT_MODEL = Path.home() / ".cache/huggingface/hub/models--Systran--faster-whisper-medium/snapshots/08e178d48790749d25932bbc082711ddcfdfbc4f"


def without_punctuation(text):
    return "".join(char for char in text if not unicodedata.category(char).startswith(("P", "Z"))).strip()


def transcribe_kwargs():
    return dict(language="zh", task="transcribe", beam_size=5, best_of=1,
                temperature=0, condition_on_previous_text=False,
                initial_prompt=None, prefix=None, hotwords=None,
                vad_filter=False, word_timestamps=False)


def classify_transcript(text, expected):
    if not without_punctuation(text):
        return "empty-transcript-review", "ASR produced no text. This may reflect recognizer failure on a short clip."
    if without_punctuation(text) == without_punctuation(expected):
        return "transcript-match-review", "Unprompted ASR spelling matches. Exact tone, phonetic quality and naturalness remain unverified."
    return "transcript-differs-review", "Unprompted ASR spelling differs. Homophones and alternate character choices require pronunciation comparison; this is not an automatic rejection."


def save(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    args = parser.parse_args()
    path = args.manifest.resolve(strict=True)
    if not path.is_relative_to(HERE / "runs"):
        parser.error("only new audition runs may be screened")
    manifest = json.loads(path.read_text())
    if manifest.get("status") != "complete":
        parser.error("generation must finish before ASR screening")
    output = path.parent / "asr-screen.json"
    if output.exists():
        parser.error("this run already has an ASR screen; existing results are not overwritten")
    model_path = args.model.resolve(strict=True)
    if not (model_path / "model.bin").is_file():
        parser.error("complete local ASR weights are required")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_path), device="cpu", compute_type="int8", cpu_threads=6, num_workers=1, local_files_only=True)
    report = {"createdAt": dt.datetime.now(dt.timezone.utc).isoformat(), "status": "running",
              "model": "Systran/faster-whisper-medium", "modelRevision": model_path.name,
              "settings": transcribe_kwargs(), "expectedTextProvidedToASR": False,
              "limitations": "ASR predicts plausible text and can hallucinate short utterances. No phonetic, tone, naturalness, speaker or human approval is inferred.",
              "clips": []}
    started = time.monotonic()
    for clip in manifest["clips"]:
        if not clip.get("sha256"):
            clip["aiAudit"] = {"status": "not-transcribed", "note": "No generated file was available."}
            continue
        audio = path.parent / "clips" / clip["fileName"]
        if audio.parent != path.parent / "clips" or hashlib.sha256(audio.read_bytes()).hexdigest() != clip["sha256"]:
            raise ValueError("clip path or content hash no longer matches generation manifest")
        clip_start = time.monotonic()
        segments, info = model.transcribe(str(audio), **transcribe_kwargs())
        segments = list(segments)
        transcript = "".join(segment.text for segment in segments).strip()
        status, note = classify_transcript(transcript, clip["text"])
        clip["aiAudit"] = {"status": status, "transcript": transcript, "note": note,
                           "model": report["model"], "expectedTextProvidedToASR": False}
        evidence = {"id": clip["id"], "sha256": clip["sha256"], "transcript": transcript,
                    "status": status, "seconds": round(time.monotonic() - clip_start, 3),
                    "segments": [{"text": s.text, "start": s.start, "end": s.end,
                                  "avgLogProb": s.avg_logprob, "noSpeechProb": s.no_speech_prob,
                                  "compressionRatio": s.compression_ratio} for s in segments]}
        report["clips"].append(evidence)
        save(output, report)
        save(path, manifest)
        print(json.dumps({"progress": len(report["clips"]), "id": clip["id"],
                          "transcript": transcript, "status": status, "seconds": evidence["seconds"]}, ensure_ascii=False), flush=True)
    report.update(status="complete", elapsedSeconds=round(time.monotonic() - started, 3))
    save(output, report)
    manifest["asrScreen"] = {"model": report["model"], "expectedTextProvidedToASR": False,
                             "status": "complete", "screenedClips": len(report["clips"])}
    save(path, manifest)
    print(json.dumps({"report": str(output), "elapsedSeconds": report["elapsedSeconds"]}), flush=True)


if __name__ == "__main__": main()
