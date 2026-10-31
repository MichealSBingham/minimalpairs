#!/usr/bin/env python3
"""Bounded, isolated Chirp 3 HD audition. Default: no network, credentials or writes.

Only the frozen 16-pair selection can be synthesized. The script does not enable
services, create accounts, change billing, or publish files. No POST retries.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
BUDGET_DIR = HERE / "private"  # Canonical across candidate-store paths and invocations.
AUTHORIZED_PROJECT = "minimalpairs-audio-20260928"
ENDPOINT = "https://texttospeech.googleapis.com/v1/"
SOURCE_ID = "google-chirp3-hd-audition-v1"
URL_PREFIX = "/audio/google-chirp3-hd-audition"
MODEL = "Chirp3-HD"
MODEL_REVISION = "provider-managed-unpinned"
RATE_PER_MILLION_USD = 30
BUDGET_USD_MICROS = 1_000_000  # Exactly $1; integer arithmetic, never credits/quota.
RATE_USD_MICROS_PER_CHARACTER = 30
MAX_CLIPS = 64
MAX_CHARACTERS = 2000
MAX_RESPONSE_BYTES = 2_000_000
LOCALES = {"en": "en-US", "fr": "fr-FR", "de": "de-DE", "es": "es-US",
           "it": "it-IT", "zh": "cmn-CN", "pt": "pt-BR", "ru": "ru-RU"}
ALLOWLIST = {
    "en": ("en-i-ih", {"en-ship-sheep": ["ship", "sheep"], "en-fill-feel": ["fill", "feel"]}),
    "fr": ("fr-u-y", {"fr-tout-tu": ["tout", "tu"], "fr-vous-vu": ["vous", "vu"]}),
    "de": ("de-u-ue", {"de-musste-muesste": ["musste", "müsste"], "de-wurde-wuerde": ["wurde", "würde"]}),
    "es": ("es-tap-trill", {"es-caro-carro": ["caro", "carro"], "es-pero-perro": ["pero", "perro"]}),
    "it": ("it-length", {"it-pala-palla": ["pala", "palla"], "it-fato-fatto": ["fato", "fatto"]}),
    "zh": ("zh-tone-1-4", {"zh-ma1-ma4": ["妈", "骂"], "zh-shu1-shu4": ["书", "树"]}),
    "pt": ("pt-f-v", {"pt-faca-vaca": ["faca", "vaca"], "pt-fila-vila": ["fila", "vila"]}),
    "ru": ("ru-hard-soft", {"ru-luk-lyuk": ["лук", "люк"], "ru-nos-nyos": ["нос", "нёс"]}),
}


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def languages(value):
    selected = list(LOCALES) if value == "all" else value.split(",")
    if not selected or len(set(selected)) != len(selected) or any(s not in LOCALES for s in selected):
        raise ValueError("Use 'all' or distinct comma-separated en,fr,de,es,it,zh,pt,ru.")
    return [lang for lang in LOCALES if lang in selected]


def load_selection(path=HERE / "selection.json"):
    data = json.loads(path.read_text())
    scopes = data.get("scopes", [])
    if len(scopes) != 8 or {s.get("languageId") for s in scopes} != set(LOCALES):
        raise ValueError("Selection must contain exactly the eight frozen audition scopes.")
    for scope in scopes:
        lang = scope["languageId"]
        contrast, expected = ALLOWLIST[lang]
        pairs = scope.get("pairs", [])
        if scope.get("contrastId") != contrast or len(pairs) != 2:
            raise ValueError("Selection contrast or pair count differs from the allowlist.")
        if {p.get("id") for p in pairs} != set(expected):
            raise ValueError("Selection pair IDs differ from the allowlist.")
        for pair in pairs:
            if [w.get("text") for w in pair.get("words", [])] != expected[pair["id"]]:
                raise ValueError("Selection words/order differ from the allowlist.")
            for word in pair["words"]:
                if word.get("ttsText", word["text"]) != word["text"] or word.get("audioText", word["text"]) != word["text"]:
                    raise ValueError("Speech overrides require a separately reviewed audition definition.")
    return data


def voice(lang, name):
    locale = LOCALES[lang]
    return {"id": f"google-{locale}-{name}", "name": name, "providerVoice": f"{locale}-Chirp3-HD-{name}",
            "locale": locale, "provider": "google-cloud-tts", "synthetic": True,
            "description": f"{locale} synthetic named voice; pronunciation and speaker consistency unreviewed"}


def jobs_for(selection, selected):
    jobs = []
    scopes = {s["languageId"]: s for s in selection["scopes"]}
    for lang in selected:
        scope = scopes[lang]
        for pair in scope["pairs"]:
            for category, word in enumerate(pair["words"]):
                for name in ("Aoede", "Charon"):
                    profile = voice(lang, name)
                    request = {"input": {"text": word["text"]},
                               "voice": {"languageCode": LOCALES[lang], "name": profile["providerVoice"]},
                               "audioConfig": {"audioEncoding": "MP3", "sampleRateHertz": 24000}}
                    settings = {"schemaVersion": 1, "provider": "google-cloud-tts", "apiVersion": "v1",
                                "model": MODEL, "modelRevision": MODEL_REVISION, "request": request}
                    jobs.append({"cacheKey": digest(settings), "settings": settings, "languageId": lang,
                                 "text": word["text"], "targetIPA": word.get("ipa"),
                                 "targetRomanization": word.get("romanization"), "intendedMeaning": word.get("meaning"),
                                 "curriculumLocale": scope["curriculumLocale"], "locale": LOCALES[lang],
                                 "contrastId": scope["contrastId"], "pairId": pair["id"], "category": category,
                                 "sources": pair.get("sources", []), "voice": profile})
    return jobs


def paths(root, key):
    if not re.fullmatch(r"[0-9a-f]{64}", key):
        raise ValueError("Invalid cache key.")
    return root / "clips" / f"{key}.mp3", root / "records" / f"{key}.json", root / "attempts" / f"{key}.json"


def validate_store(root):
    if any(p in ("public", "dist") for p in root.resolve().parts) or root.is_symlink():
        raise ValueError("Refusing to write into a published asset/build directory or symlink.")
    if root.exists() and any(path.is_symlink() for path in root.rglob("*")):
        raise ValueError("Symlinks are not allowed inside the isolated candidate store.")
    if BUDGET_DIR.is_symlink():
        raise ValueError("Budget state directory must not be a symlink.")
    for name in ("budget-ledger.json", "budget-initialized.json", ".budget.lock"):
        if (BUDGET_DIR / name).is_symlink():
            raise ValueError("Budget state must not be a symlink.")


def load_budget(root, project=None):
    if project and project != AUTHORIZED_PROJECT:
        raise ValueError("Only the authorized isolated audio project may use this audition; production/other projects are forbidden.")
    path = BUDGET_DIR / "budget-ledger.json"
    if not path.exists():
        if (BUDGET_DIR / "budget-initialized.json").exists() or any(
                (root / directory).exists() and any((root / directory).iterdir())
                for directory in ("attempts", "records", "clips")):
            raise ValueError("Budget ledger is missing despite prior execution evidence; refusing a silent reset.")
        return {"schemaVersion": 1, "sourceCollection": SOURCE_ID, "quotaProject": project,
                "ceilingUsdMicros": BUDGET_USD_MICROS,
                "rateUsdMicrosPerCharacter": RATE_USD_MICROS_PER_CHARACTER, "reservations": {}}
    try:
        data = json.loads(path.read_text())
        if (data["schemaVersion"] != 1 or data["sourceCollection"] != SOURCE_ID
                or data["ceilingUsdMicros"] != BUDGET_USD_MICROS
                or data["rateUsdMicrosPerCharacter"] != RATE_USD_MICROS_PER_CHARACTER
                or data["quotaProject"] != AUTHORIZED_PROJECT
                or not isinstance(data["reservations"], dict)):
            raise ValueError("Budget ledger schema/project/pricing differs from this authorized audition.")
        if project and data["quotaProject"] != project:
            raise ValueError("Budget is already bound to another quota project; no automatic reset/rebinding.")
        for key, reservation in data["reservations"].items():
            if (not re.fullmatch(r"[0-9a-f]{64}", key)
                    or type(reservation["characterUpperBound"]) is not int
                    or reservation["characterUpperBound"] <= 0
                    or type(reservation["reservedUsdMicros"]) is not int
                    or reservation["reservedUsdMicros"] != reservation["characterUpperBound"] * RATE_USD_MICROS_PER_CHARACTER
                    or reservation["state"] not in ("reserved", "saved", "outcome-needs-review")):
                raise ValueError("Budget reservation is invalid; refusing synthesis or reset.")
        if sum(r["reservedUsdMicros"] for r in data["reservations"].values()) > BUDGET_USD_MICROS:
            raise ValueError("Budget ledger exceeds its ceiling; manual review required.")
        return data
    except (KeyError, TypeError, json.JSONDecodeError):
        raise ValueError("Budget ledger is invalid; refusing synthesis or reset.") from None


def initialize_budget(root, project):
    data = load_budget(root, project)
    if not (BUDGET_DIR / "budget-ledger.json").exists():
        # The marker persists outside candidate/. Deleting candidate clips cannot
        # erase the spend history. Missing ledger with a marker fails closed.
        atomic_json(BUDGET_DIR / "budget-initialized.json",
                    {"sourceCollection": SOURCE_ID, "quotaProject": project,
                     "ceilingUsdMicros": BUDGET_USD_MICROS, "initializedAt": timestamp()})
        atomic_json(BUDGET_DIR / "budget-ledger.json", data)
    return data


def reserve_charge(root, project, job):
    data = load_budget(root, project)
    if job["cacheKey"] in data["reservations"]:
        raise ValueError("This request already has a budget reservation; no repeat charge permitted.")
    # UTF-8 byte length conservatively bounds billable Unicode characters for
    # these exact plain-text requests. No free tier, credits or failed-request
    # refund is assumed. There is no release/reset path.
    upper = len(job["settings"]["request"]["input"]["text"].encode("utf-8"))
    amount = upper * RATE_USD_MICROS_PER_CHARACTER
    spent = sum(r["reservedUsdMicros"] for r in data["reservations"].values())
    if spent + amount > BUDGET_USD_MICROS:
        raise ValueError("Cumulative $1 generation budget would be exceeded; no request sent.")
    data["reservations"][job["cacheKey"]] = {
        "characterUpperBound": upper, "reservedUsdMicros": amount,
        "requestSha256": digest(job["settings"]["request"]),
        "state": "reserved", "reservedAt": timestamp()}
    atomic_json(BUDGET_DIR / "budget-ledger.json", data)


def record_outcome(root, project, key, state):
    data = load_budget(root, project)
    reservation = data["reservations"][key]
    reservation["state"] = state
    reservation["updatedAt"] = timestamp()
    # Keep the full reserved amount even on error/timeout or early interruption.
    atomic_json(BUDGET_DIR / "budget-ledger.json", data)


def cache_state(root, job):
    audio, record, attempt = paths(root, job["cacheKey"])
    if record.exists():
        try:
            data = json.loads(record.read_text())
            if data["cacheKey"] != job["cacheKey"] or data["settings"] != job["settings"]:
                return "blocked", "cache-request-mismatch"
            if data["sha256"] != file_hash(audio) or data["bytes"] != audio.stat().st_size:
                return "blocked", "cache-integrity-mismatch"
            if not data.get("engineering", {}).get("decoded"):
                return "blocked", "cache-not-decoded"
            return "cached", None
        except (OSError, ValueError, KeyError, TypeError):
            return "blocked", "cache-unreadable"
    if attempt.exists() or audio.exists():
        return "blocked", "prior-request-outcome-needs-manual-review"
    return "new", None


def make_plan(selection, selected, root, project=None, max_characters=MAX_CHARACTERS):
    if not 0 < max_characters <= MAX_CHARACTERS:
        raise ValueError(f"Character limit must be 1..{MAX_CHARACTERS}.")
    jobs = jobs_for(selection, selected)
    if not jobs or len(jobs) > MAX_CLIPS or len({j["cacheKey"] for j in jobs}) != len(jobs):
        raise ValueError("Batch exceeds the frozen unique-clip limit.")
    budget = load_budget(root, project)
    rows = []
    for job in jobs:
        state, reason = cache_state(root, job)
        if state == "new" and job["cacheKey"] in budget["reservations"]:
            state, reason = "blocked", "prior-budget-reservation-needs-manual-review"
        rows.append({"cacheKey": job["cacheKey"], "languageId": job["languageId"], "text": job["text"],
                     "voiceName": job["voice"]["providerVoice"], "locale": job["locale"],
                     "targetIPA": job["targetIPA"], "status": state, "reason": reason,
                     "characters": len(job["text"]), "utf8Bytes": len(job["text"].encode())})
    uncached = [r for r in rows if r["status"] == "new"]
    characters = sum(r["characters"] for r in uncached)
    if characters > max_characters:
        raise ValueError("Uncached batch exceeds the requested character ceiling.")
    reserved = sum(r["reservedUsdMicros"] for r in budget["reservations"].values())
    required = sum(r["utf8Bytes"] for r in uncached) * RATE_USD_MICROS_PER_CHARACTER
    plan = {"schemaVersion": 1, "sourceId": SOURCE_ID, "project": project,
            "selectionSha256": digest(selection), "languages": selected, "clips": rows,
            "counts": {"selected": len(rows), "cached": sum(r["status"] == "cached" for r in rows),
                       "newRequests": len(uncached), "blocked": sum(r["status"] == "blocked" for r in rows)},
            "charactersToSynthesize": characters, "utf8BytesToSynthesize": sum(r["utf8Bytes"] for r in uncached),
            "hardBatchClipLimit": MAX_CLIPS, "characterCeiling": max_characters,
            "listPriceEstimateUsdNoFreeQuota": round(characters * RATE_PER_MILLION_USD / 1_000_000, 8),
            "priceBasis": {"usdPerMillionCharacters": RATE_PER_MILLION_USD, "checkedAt": "2026-09-28",
                           "source": "https://cloud.google.com/text-to-speech/pricing"},
            "assumedFreeQuota": 0, "billingEligibilityVerified": False,
            "cumulativeBudget": {"ceilingUsd": 1, "reservedUsd": reserved / 1_000_000,
                                 "remainingUsd": (BUDGET_USD_MICROS - reserved) / 1_000_000,
                                 "newBatchReservationUsd": required / 1_000_000,
                                 "fits": reserved + required <= BUDGET_USD_MICROS,
                                 "basis": "UTF-8 bytes as conservative plain-text character bound; no free quota",
                                 "ledgerSha256": digest(budget), "boundQuotaProject": budget["quotaProject"]},
            "warnings": ["Estimate covers this synthesis batch only; quotas/credits and other project costs are not inspected.",
                         "Provider-managed model revision is not immutable; identical requests need not yield identical audio.",
                         "Spanish provider locale es-US is not the curriculum target es-MX.",
                         "The $1 ledger bounds only this tool's list-price generation reservations, not unrelated account usage.",
                         "Generated candidates are not pronunciation- or speaker-consistency-reviewed."]}
    plan["planSha256"] = digest(plan)
    return plan, jobs


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GoogleTransport:
    """Explicit execute-only credentials. Never invoked by a plan or fixture test."""
    def __init__(self, project):
        if not project or not re.fullmatch(r"[a-z][a-z0-9-]{4,61}[a-z0-9]", project):
            raise ValueError("An explicit Google project ID is required.")
        token = os.environ.get("GOOGLE_OAUTH_ACCESS_TOKEN")
        if not token:
            raise ValueError("Set GOOGLE_OAUTH_ACCESS_TOKEN through the operator environment. No credential discovery is automatic.")
        self.headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json",
                        "X-Goog-User-Project": project}
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, payload=None):
        if method not in ("voices", "text:synthesize"):
            raise ValueError("Endpoint not allowlisted.")
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(ENDPOINT + method, data=data, headers=self.headers)
        try:
            with self.opener.open(req, timeout=60) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise RuntimeError("Provider response exceeds audition size ceiling.")
                return json.loads(body)
        except urllib.error.HTTPError as error:
            # Do not log body, URL, headers, token, or service-provided messages.
            raise RuntimeError(f"Google HTTP {error.code}; no automatic retry.") from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise RuntimeError("Google response unavailable or invalid; no automatic retry.") from None

    def catalog(self):
        return self.request("voices")

    def synthesize(self, request):
        return self.request("text:synthesize", request)


def verify_audio(path):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("ffmpeg and ffprobe are required before synthesis.")
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name,sample_rate,channels",
                            "-of", "json", str(path)], capture_output=True, text=True, timeout=15)
    if probe.returncode:
        raise RuntimeError("Returned audio does not decode as an MP3.")
    details = json.loads(probe.stdout)
    duration = float(details.get("format", {}).get("duration", 0))
    streams = details.get("streams", [])
    if not math.isfinite(duration) or not 0 < duration <= 15 or len(streams) != 1 or streams[0].get("codec_name") != "mp3":
        raise RuntimeError("Returned audio violates audition format/duration ceiling.")
    if int(streams[0].get("sample_rate", 0)) != 24000 or streams[0].get("channels") != 1:
        raise RuntimeError("Returned audio differs from requested 24 kHz mono format.")
    decode = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"],
                             capture_output=True, timeout=15)
    if decode.returncode:
        raise RuntimeError("Returned audio failed full decoding.")
    return {"decoded": True, "codec": "mp3", "sampleRate": 24000, "channels": 1,
            "durationSeconds": duration,
            "warnings": ["isolated-word-duration-outside-0.2-to-3-seconds"] if duration < .2 or duration > 3 else []}


def write_manifest(root, selection):
    clips, profiles, scopes = [], {}, []
    for job in jobs_for(selection, list(LOCALES)):
        if cache_state(root, job)[0] != "cached":
            continue
        _, record, _ = paths(root, job["cacheKey"])
        stored = json.loads(record.read_text())
        clip = {k: job[k] for k in ("languageId", "text", "targetIPA", "targetRomanization", "intendedMeaning", "locale", "curriculumLocale", "contrastId", "pairId", "category", "sources")}
        clip.update({"id": job["cacheKey"], "voiceId": job["voice"]["id"], "url": f"{URL_PREFIX}/clips/{job['cacheKey']}.mp3",
                     "provider": "google-cloud-tts", "model": MODEL, "modelRevision": MODEL_REVISION,
                     "status": "generated-unreviewed", "synthetic": True, "phoneticListeningVerified": False,
                     "speakerConsistencyVerified": False, "sourceCollection": SOURCE_ID,
                     "ttsText": job["text"], "settings": job["settings"],
                     **{k: stored[k] for k in ("sha256", "bytes", "generatedAt", "engineering")}})
        clips.append(clip)
        profiles.setdefault(job["languageId"], {})[job["voice"]["id"]] = job["voice"]
    for scope in selection["scopes"]:
        expected = jobs_for(selection, [scope["languageId"]])
        if all(cache_state(root, j)[0] == "cached" for j in expected):
            scopes.append({"languageId": scope["languageId"], "contrastId": scope["contrastId"],
                           "pairIds": [p["id"] for p in scope["pairs"]], "providerLocale": LOCALES[scope["languageId"]]})
    manifest = {"schemaVersion": 1, "sourceCollection": SOURCE_ID, "status": "generated-unreviewed",
                "phoneticListeningVerified": False, "speakerConsistencyVerified": False,
                "voicesByLanguage": {lang: list(p.values()) for lang, p in profiles.items()},
                "clips": clips, "completeScopes": scopes, "selectionSha256": digest(selection),
                "publicationStatus": "isolated-candidate-not-published"}
    atomic_json(root / "manifest.candidate.json", manifest)
    return manifest


def execute(selection, selected, root, project, expected_hash, max_characters=MAX_CHARACTERS,
            transport_factory=GoogleTransport):
    # root is fixed by the CLI. Tests use isolated temporary paths.
    validate_store(root)
    if project != AUTHORIZED_PROJECT:
        raise ValueError("Execution is pinned to the authorized isolated audio project.")
    plan, _ = make_plan(selection, selected, root, project, max_characters)
    if plan["planSha256"] != expected_hash:
        raise ValueError("Plan changed or approval hash does not match; produce a fresh dry run.")
    if plan["counts"]["blocked"]:
        raise ValueError("Prior request/cache needs manual review; no automatic resubmission.")
    if not plan["cumulativeBudget"]["fits"]:
        raise ValueError("Cumulative $1 generation budget cannot cover this batch; no network calls.")
    root.mkdir(parents=True, exist_ok=True)
    BUDGET_DIR.mkdir(parents=True, exist_ok=True)
    with (BUDGET_DIR / ".budget.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        plan, jobs = make_plan(selection, selected, root, project, max_characters)
        if plan["planSha256"] != expected_hash:
            raise ValueError("Cache changed while waiting for execution lock; rerun the plan.")
        pending = [j for j in jobs if cache_state(root, j)[0] == "new"]
        if not pending:
            return write_manifest(root, selection)
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            raise ValueError("Install ffmpeg/ffprobe before any provider request.")
        initialize_budget(root, project)
        atomic_json(root / "last-executed-plan.json", plan)
        transport = transport_factory(project)
        catalog = {v["name"]: v for v in transport.catalog().get("voices", [])}
        for job in pending:
            name = job["voice"]["providerVoice"]
            if name not in catalog or job["locale"] not in catalog[name].get("languageCodes", []):
                raise ValueError("Exact named voice/locale unavailable; no synthesis or fallback.")
        # Catalog is public metadata; never persist the transport or its headers.
        atomic_json(root / "catalog-selected.json", {"checkedAt": timestamp(), "voices": [catalog[n] for n in sorted({j['voice']['providerVoice'] for j in pending})]})
        for job in pending:
            audio, record, attempt = paths(root, job["cacheKey"])
            reserve_charge(root, project, job)  # Durable worst-case cost BEFORE POST.
            started = {"cacheKey": job["cacheKey"], "state": "started", "startedAt": timestamp(),
                       "planSha256": expected_hash, "requestSha256": digest(job["settings"]["request"]), "attemptNumber": 1}
            atomic_json(attempt, started)  # Durable before the possibly billable request.
            try:
                result = transport.synthesize(job["settings"]["request"])
                encoded = result.get("audioContent")
                if not isinstance(encoded, str) or len(encoded) > MAX_RESPONSE_BYTES:
                    raise ValueError("Missing/oversized audio response.")
                audio_bytes = base64.b64decode(encoded, validate=True)
                if not audio_bytes:
                    raise ValueError("Empty audio response.")
                audio.parent.mkdir(parents=True, exist_ok=True)
                temporary = audio.with_suffix(".partial.mp3")
                with temporary.open("wb") as stream:
                    stream.write(audio_bytes)
                    stream.flush()
                    os.fsync(stream.fileno())
                engineering = verify_audio(temporary)
                temporary.replace(audio)
                stored = {"cacheKey": job["cacheKey"], "settings": job["settings"], "sha256": file_hash(audio),
                          "bytes": audio.stat().st_size, "generatedAt": timestamp(), "engineering": engineering,
                          "planSha256": expected_hash, "attemptNumber": 1}
                atomic_json(record, stored)
                atomic_json(attempt, {**started, "state": "saved", "completedAt": timestamp()})
                record_outcome(root, project, job["cacheKey"], "saved")
                write_manifest(root, selection)
            except Exception:
                record_outcome(root, project, job["cacheKey"], "outcome-needs-review")
                atomic_json(attempt, {**started, "state": "outcome-needs-review", "endedAt": timestamp(),
                                      "note": "Request may have been billed. Automatic retry is forbidden; inspect private attempt/files."})
                write_manifest(root, selection)
                raise RuntimeError(f"Audition stopped at {job['cacheKey']}; outcome needs review. No automatic retry.") from None
        return write_manifest(root, selection)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--languages", default="en", help="Comma-separated language IDs, or all; default en (8 clips).")
    parser.add_argument("--project", help="Explicit quota project ID; included in the plan hash.")
    parser.add_argument("--max-characters", type=int, default=MAX_CHARACTERS)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--plan-sha256", help="Exact hash from the immediately reviewed dry-run plan.")
    parser.add_argument("--confirm-authorized-paid-project", action="store_true",
                        help="Attest this is the owner's authorized isolated paid audio project; not a live billing check.")
    args = parser.parse_args(argv)
    try:
        selection = load_selection()
        selected = languages(args.languages)
        root = HERE / "candidate"
        if not root.resolve().is_relative_to(HERE.resolve()):
            raise ValueError("Candidate path must stay inside this isolated audition directory.")
        plan, _ = make_plan(selection, selected, root, args.project, args.max_characters)
        print(json.dumps(plan, ensure_ascii=False, indent=2), flush=True)
        if args.execute:
            if not args.project or not args.plan_sha256 or not args.confirm_authorized_paid_project:
                raise ValueError("Execution requires --project, --plan-sha256 and --confirm-authorized-paid-project.")
            manifest = execute(selection, selected, root, args.project, args.plan_sha256, args.max_characters)
            print(json.dumps({"generatedCandidateClips": len(manifest["clips"]), "completeScopes": manifest["completeScopes"],
                              "published": False, "phoneticListeningVerified": False}, ensure_ascii=False))
        return 0
    except (ValueError, RuntimeError, OSError) as error:
        # Only our sanitized messages reach stdout/stderr; no token/body logging.
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
