#!/usr/bin/env python3
"""Offline, content-addressed speech generation. No synthesis runs in the website.

Every generated clip starts unreviewed. This script NEVER certifies pronunciation.
Google mode uses the Python standard library; Qwen mode uses requirements-local.txt.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
DEFAULT_OUTPUT = HERE.parent / "app/public/audio"
QWEN_REPO = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit"
QWEN_REVISION = "5c390979e4b93af5f2932f90742ca99c7dd04687"
LANGUAGES = {
    "en": ("en-US", "English", "General American English"),
    "fr": ("fr-FR", "French", "standard metropolitan French from France"),
    "es": ("es-US", "Spanish", "Mexican Spanish"),
    "de": ("de-DE", "German", "standard German from Germany"),
    "it": ("it-IT", "Italian", "standard Italian from Italy"),
    "ru": ("ru-RU", "Russian", "standard Russian from Russia"),
    "zh": ("cmn-CN", "Chinese", "standard Mandarin Chinese, Putonghua"),
    "pt": ("pt-BR", "Portuguese", "standard Brazilian Portuguese"),
}
VOICE_STYLES = {
    "a": "An adult woman with a clear, relaxed middle-pitched voice.",
    "b": "An adult man with a warm, clear lower-pitched voice.",
}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()


def google_headers():
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("GOOGLE_TTS_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    token = os.environ.get("GOOGLE_OAUTH_ACCESS_TOKEN")
    if key:
        headers["X-Goog-Api-Key"] = key
    else:
        if not token and shutil.which("gcloud"):
            result = subprocess.run(["gcloud", "auth", "application-default",
                                     "print-access-token"], capture_output=True, text=True)
            if result.returncode == 0:
                token = result.stdout.strip()
        if not token:
            raise RuntimeError("Google TTS credentials unavailable. Set GOOGLE_TTS_API_KEY "
                               "or GOOGLE_OAUTH_ACCESS_TOKEN, or configure gcloud ADC.")
        headers["Authorization"] = "Bearer " + token
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if project:
        headers["X-Goog-User-Project"] = project
    return headers


def google_request(method, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request("https://texttospeech.googleapis.com/v1/" + method,
                                 data=data, headers=google_headers())
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Do not print request headers or URLs containing authentication material.
        body = json.loads(error.read().decode())
        message = body.get("error", {}).get("message", "Request failed")
        raise RuntimeError(f"Google TTS HTTP {error.code}: {message}") from None


def voice_for(provider, language_id, slot):
    locale, language, dialect = LANGUAGES[language_id]
    if provider == "google":
        name = "Aoede" if slot == "a" else "Charon"
        if language_id == "es":
            dialect = "US Spanish; Mexican-target pronunciation review pending"
        return {"id": f"google-{locale}-{name}", "name": name,
                "providerVoice": f"{locale}-Chirp3-HD-{name}",
                "description": f"{dialect}; synthetic voice, pronunciation review pending",
                "provider": "google", "locale": locale, "dialect": dialect}
    return {"id": f"qwen-{language_id}-{slot}", "name": "Voice A" if slot == "a" else "Voice B",
            "description": f"Experimental synthetic {dialect} voice; accent and consistency unreviewed",
            "provider": "qwen", "locale": locale, "dialect": dialect,
            "instruct": f"{VOICE_STYLES[slot]} A native speaker of {dialect}. "
                        "Speak in a neutral, clear conversational tone at a normal pace. "
                        "Read only the exact provided text once, with no added words or sounds."}


def read_items(path: Path):
    document = json.loads(path.read_text())
    if isinstance(document, dict) and "items" in document:
        items = document["items"]
    elif isinstance(document, list) and all("text" in row for row in document):
        items = document
    else:
        # Curriculum adapter: support an array or {languages: [...]} container.
        languages = document.get("languages", []) if isinstance(document, dict) else document
        items = []
        for language in languages:
            language_id = language.get("id") or language.get("languageId")
            for contrast in language.get("contrasts", []):
                for pair in contrast.get("pairs", []):
                    words = pair.get("words") or [pair.get("a"), pair.get("b")]
                    for word in words:
                        if not word:
                            raise ValueError(f"Pair has no words: {pair}")
                        if isinstance(word, str):
                            text = word
                            tts_text = word
                        else:
                            text = word.get("text") or word.get("word")
                            tts_text = word.get("ttsText") or word.get("audioText") or text
                        items.append({"languageId": language_id, "text": text,
                                      "ttsText": tts_text, "contrastId": contrast.get("id"),
                                      "pairId": pair.get("id"),
                                      "targetIPA": word.get("ipa") if isinstance(word, dict) else None,
                                      "targetRomanization": word.get("romanization") if isinstance(word, dict) else None,
                                      "intendedMeaning": word.get("meaning") if isinstance(word, dict) else None,
                                      "curriculumLocale": language.get("locale"),
                                      "sources": pair.get("sources", [])})
    unique = {}
    for item in items:
        if item.get("languageId") not in LANGUAGES or not item.get("text"):
            raise ValueError(f"Missing/unsupported languageId or text: {item}")
        speech = item.get("ttsText") or item["text"]
        if len(speech) > 500:
            raise ValueError("This word/phrase cache limits an item to 500 characters.")
        key = (item["languageId"], item["text"], speech)
        prior = unique.get(key)
        if prior and prior.get("targetIPA") != item.get("targetIPA"):
            raise ValueError(f"Same written word has multiple intended pronunciations: {key}; "
                             "add explicit ttsText and review the frontend lexical key")
        unique[key] = item
    overrides_path = HERE / "pronunciation-overrides.json"
    overrides = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
    for item in unique.values():
        override = overrides.get(item["languageId"] + ":" + item["text"])
        if override:
            item["pronunciationInstruction"] = override["instruction"]
            item["pronunciationNote"] = override["reason"]
    return list(unique.values())


class QwenGenerator:
    def __init__(self):
        import mlx.core as mx
        from huggingface_hub import snapshot_download
        from mlx_audio.tts.utils import load_model
        self.mx = mx
        path = snapshot_download(QWEN_REPO, revision=QWEN_REVISION)
        self.model = load_model(path)

    def generate(self, item, voice, path, seed):
        import numpy as np
        import soundfile as sf
        self.mx.random.seed(seed)
        outputs = list(self.model.generate_voice_design(
            text=item.get("ttsText") or item["text"],
            language=LANGUAGES[item["languageId"]][1],
            instruct=voice["instruct"] + (" " + item["pronunciationInstruction"]
                                         if item.get("pronunciationInstruction") else ""),
            temperature=0.65, top_p=0.9, max_tokens=180,
        ))
        if not outputs:
            raise RuntimeError("Qwen returned no waveform")
        audio = np.concatenate([np.array(part.audio) for part in outputs])
        sample_rate = outputs[0].sample_rate
        if len(audio) == 0 or not np.isfinite(audio).all():
            raise RuntimeError("Qwen produced empty or non-finite audio")
        # A conservative peak adjustment only; never stretch, denoise, or trim consonants.
        peak = float(np.max(np.abs(audio)))
        if peak > 0.98:
            audio = audio * (0.98 / peak)
        sf.write(path, audio, sample_rate, subtype="PCM_16")
        return {"durationSeconds": round(len(audio) / sample_rate, 3),
                "sampleRate": sample_rate, "peakBeforeAdjustment": round(peak, 5),
                "generationTokenCount": sum(part.token_count for part in outputs),
                "seed": seed,
                "synthesisInputType": "isolated-written-word"}


def encode_mp3(wav: Path, destination: Path):
    if not shutil.which("ffmpeg"):
        raise RuntimeError("Install ffmpeg to encode local Qwen waveforms as MP3")
    result = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav),
                             "-codec:a", "libmp3lame", "-b:a", "96k", str(destination)],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("MP3 encoding failed: " + result.stderr[:250])


def generation_settings(provider, item, voice, seed):
    settings = {"provider": provider, "voice": voice,
                "text": item.get("ttsText") or item["text"],
                "model": "Chirp3-HD" if provider == "google" else QWEN_REPO,
                "revision": QWEN_REVISION if provider == "qwen" else "provider-managed",
                "encoding": "MP3", "sampleRate": 24000,
                "seed": seed if provider == "qwen" else None,
                "temperature": 0.65 if provider == "qwen" else None,
                "topP": 0.9 if provider == "qwen" else None,
                "maxTokens": 180 if provider == "qwen" else None}
    if provider == "qwen" and item.get("pronunciationInstruction"):
        settings["pronunciationInstruction"] = item["pronunciationInstruction"]
    return settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path)
    parser.add_argument("--provider", choices=["google", "qwen"], default="google")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--language", choices=list(LANGUAGES))
    parser.add_argument("--limit", type=int, help="Maximum distinct words/phrases, before voice expansion")
    parser.add_argument("--voices", choices=["a", "b", "both"], default="both")
    parser.add_argument("--max-characters", type=int, default=100000,
                        help="Hard per-invocation uncached character ceiling")
    parser.add_argument("--seed-offset", type=int, default=0,
                        help="Qwen retry experiment; changes seed and cache key")
    parser.add_argument("--list-google-voices", action="store_true")
    parser.add_argument("--execute", action="store_true", help="Generate; default is a no-network plan")
    args = parser.parse_args()
    if args.list_google_voices:
        voices = google_request("voices")["voices"]
        print(json.dumps([v for v in voices if "Chirp3-HD" in v["name"] and
                          any(locale == v["languageCodes"][0] for locale, _, _ in LANGUAGES.values())],
                         ensure_ascii=False, indent=2))
        return
    if not args.input:
        parser.error("input is required unless listing voices")
    items = read_items(args.input)
    if args.language:
        items = [i for i in items if i["languageId"] == args.language]
    if args.limit is not None:
        items = items[:args.limit]
    slots = ("a", "b") if args.voices == "both" else (args.voices,)
    seed_path = HERE / "generation-overrides.json"
    seed_overrides = json.loads(seed_path.read_text()) if seed_path.exists() else {}
    plans = []
    for item in items:
        for slot in slots:
            voice = voice_for(args.provider, item["languageId"], slot)
            seed_key = f"{item['languageId']}:{item['text']}:{slot}"
            seed = seed_overrides.get(seed_key, {}).get("seed", 4200 + (0 if slot == "a" else 1)) + args.seed_offset
            settings = generation_settings(args.provider, item, voice, seed)
            clip_id = digest(settings)
            path = args.output / "clips" / (clip_id + ".mp3")
            plans.append((item, voice, settings, path, clip_id, seed))
    uncached = [p for p in plans if not p[3].exists()]
    characters = sum(len(p[2]["text"]) for p in uncached)
    if characters > args.max_characters:
        raise RuntimeError(f"Plan requires {characters} characters, exceeding cap {args.max_characters}")
    summary = {"provider": args.provider, "items": len(items), "clips": len(plans),
               "cached": len(plans) - len(uncached), "uncachedCharacters": characters,
               "googleListPriceUSDIfNoFreeQuotaRemains": round(characters * 0.00003, 6)
               if args.provider == "google" else 0,
               "executed": args.execute, "status": "generated-unreviewed"}
    print(json.dumps(summary), flush=True)
    if not args.execute:
        return
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "clips").mkdir(exist_ok=True)
    # Serialize writers so parallel provider batches cannot lose manifest entries.
    lock = (HERE / ".cache-generation.lock").open("a")
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
    manifest_path = args.output / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {
        "schemaVersion": 1, "voicesByLanguage": {}, "clips": []}
    clips = {c["id"]: c for c in manifest.get("clips", [])}
    model = None
    if args.provider == "google" and uncached:
        available = {v["name"] for v in google_request("voices")["voices"]}
        missing = sorted({p[1]["providerVoice"] for p in plans} - available)
        if missing:
            raise RuntimeError("Requested voices not present in live provider catalog: " + ", ".join(missing))
    for index, (item, voice, settings, path, clip_id, seed) in enumerate(plans, 1):
        started = time.monotonic()
        metrics = {}
        if not path.exists():
            if args.provider == "google":
                response = google_request("text:synthesize", {
                    "input": {"text": settings["text"]},
                    "voice": {"languageCode": voice["locale"], "name": voice["providerVoice"]},
                    "audioConfig": {"audioEncoding": "MP3", "sampleRateHertz": 24000}})
                data = base64.b64decode(response["audioContent"], validate=True)
                if len(data) < 100:
                    raise RuntimeError("Google returned an unexpectedly small audio file")
                temp_path = path.with_suffix(".tmp")
                temp_path.write_bytes(data)
                temp_path.replace(path)
            else:
                if model is None:
                    model = QwenGenerator()
                with tempfile.TemporaryDirectory() as temp:
                    wav = Path(temp) / "voice.wav"
                    metrics = model.generate(item, voice, wav, seed)
                    encoded = Path(temp) / "voice.mp3"
                    encode_mp3(wav, encoded)
                    shutil.copyfile(encoded, path)
            metrics["generationSeconds"] = round(time.monotonic() - started, 3)
        prior = clips.get(clip_id, {})
        record = {"id": clip_id, "languageId": item["languageId"], "text": item["text"],
                  "ttsText": settings["text"], "voiceId": voice["id"],
                  "url": "/audio/clips/" + path.name,
                  "status": prior.get("status", "generated-unreviewed"),
                  "provider": args.provider, "locale": voice["locale"],
                  "dialect": voice["dialect"], "model": settings["model"],
                  "modelRevision": settings["revision"], "synthetic": True,
                  "targetIPA": item.get("targetIPA"),
                  "targetRomanization": item.get("targetRomanization"),
                  "intendedMeaning": item.get("intendedMeaning"),
                  "curriculumLocale": item.get("curriculumLocale"),
                  "lexicalSources": item.get("sources", []),
                  "pronunciationNote": item.get("pronunciationNote"),
                  "synthesisInstruction": (voice.get("instruct", "") +
                      (" " + item["pronunciationInstruction"] if item.get("pronunciationInstruction") else ""))
                      if args.provider == "qwen" else None,
                  "license": "Google Cloud TTS terms" if args.provider == "google" else "Apache-2.0 model",
                  "createdAt": prior.get("createdAt", now()),
                  "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                  "bytes": path.stat().st_size, **{k: v for k, v in prior.items()
                                                if k in ("review", "durationSeconds", "generationSeconds",
                                                         "sampleRate", "peakBeforeAdjustment",
                                                         "generationTokenCount", "seed", "synthesisInputType",
                                                         "generationAttempt", "replacesRejectedCandidate")},
                  **metrics}
        clips[clip_id] = record
        voices = manifest["voicesByLanguage"].setdefault(item["languageId"], [])
        if not any(v["id"] == voice["id"] for v in voices):
            voices.append({k: v for k, v in voice.items() if k != "instruct"})
        manifest.update({"updatedAt": now(), "clips": list(clips.values()),
                         "note": "Generated speech is synthetic and requires contrast-specific listening review."})
        atomic_json(manifest_path, manifest)
        print(f"{index}/{len(plans)} {item['languageId']} {voice['id']} {item['text']} -> {path.name}", flush=True)
    fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
    lock.close()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
