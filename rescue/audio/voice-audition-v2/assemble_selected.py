#!/usr/bin/env python3
"""Select the one bounded repair where attempted; preserve every source recording.

This creates a review bundle, not an approved production bank.
"""
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
ORIGINAL = HERE / "runs/mandarin-customvoice-20261001"
REPAIR = HERE / "runs/mandarin-customvoice-repair-20261001"
SELECTED = HERE / "runs/mandarin-audition-selected-20261001"
CANONICAL_PRESETS = {"Vivian": "qwen-cv-zh-vivian", "Uncle_Fu": "qwen-cv-zh-uncle-fu"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def contextualize_asr(clip):
    audit = clip.get("aiAudit")
    if not audit:
        raise ValueError("ASR must finish before assembly")
    pair = (clip["text"], audit.get("transcript", ""))
    audit["rawStatus"] = audit["status"]
    if pair in {("妈", "媽"), ("汤", "湯")}:
        audit.update(status="transcript-spelling-variant-review",
                     note="The ASR used a traditional-script form of the same word. This is not a word mismatch. Exact tone, sound quality, and naturalness still need listening review.")
    elif pair in {("诗", "施"), ("糖", "堂")}:
        audit.update(status="transcript-homophone-review",
                     note="The ASR chose another character with the same standard Mandarin syllable and citation tone. This is not an automatic rejection; ASR does not independently certify that the tone was correctly spoken.")


def main():
    original = json.loads((ORIGINAL / "manifest.json").read_text())
    repair = json.loads((REPAIR / "manifest.json").read_text())
    if any(m.get("status") != "complete" or m.get("asrScreen", {}).get("status") != "complete" for m in (original, repair)):
        raise ValueError("both generation and ASR must be complete")
    replacement = {clip["repairOfClipId"]: clip for clip in repair["clips"]}
    warnings = {clip["id"] for clip in original["clips"] if clip["technicalStatus"] == "needs-review"}
    if set(replacement) != warnings or len(replacement) != 13 or len(original["clips"]) != 32:
        raise ValueError("selection must be precisely original19 plus the one13-clip repair pass")
    result = copy.deepcopy(original)
    result.update(id=SELECTED.name, createdAt=dt.datetime.now(dt.timezone.utc).isoformat(),
                  purpose="Thirty-two unreviewed Mandarin audition candidates using two fixed presets. The one bounded repair replaces13 technical warnings; one warning remains. Not approved learner audio.",
                  selection={"strategy": "repair wherever attempted; otherwise original", "chosenOriginal": 19, "chosenRepair": 13,
                             "originalManifestSha256": sha(ORIGINAL / "manifest.json"),
                             "repairManifestSha256": sha(REPAIR / "manifest.json"),
                             "listeningVerified": False, "pronunciationApproved": False}, clips=[])
    # Check all identities and hashes before creating the new bundle.
    pending = []
    for baseline in original["clips"]:
        is_repair = baseline["id"] in replacement
        selected = replacement[baseline["id"]] if is_repair else baseline
        source = REPAIR if is_repair else ORIGINAL
        clip = copy.deepcopy(selected)
        if clip["reviewStatus"] != "pending":
            raise ValueError("source review state unexpectedly changed")
        audio = source / "clips" / clip["fileName"]
        if audio.parent != source / "clips" or sha(audio) != clip["sha256"]:
            raise ValueError("source content hash or file path mismatch")
        clip.update(generationProfileId=clip["voiceId"], voiceId=CANONICAL_PRESETS[clip["speaker"]],
                    url=f"/audio/voice-audition-v2/{SELECTED.name}/clips/{clip['fileName']}",
                    selectionOrigin="repair" if is_repair else "original", sourceRunId=source.name,
                    originalClipId=baseline["id"], originalClipSha256=baseline["sha256"])
        # Old baseline clips already encode the exact text; expose it explicitly.
        clip.setdefault("synthesisText", clip["text"])
        contextualize_asr(clip)
        result["clips"].append(clip)
        pending.append((audio, clip))
    identities = {(clip["wordId"], clip["voiceId"]) for clip in result["clips"]}
    if len(identities) != 32 or len({word for word, _ in identities}) != 16:
        raise ValueError("selection must cover16words by2preset identities exactly")
    SELECTED.mkdir(parents=True, exist_ok=False)
    (SELECTED / "clips").mkdir()
    for source, clip in pending:
        destination = SELECTED / "clips" / clip["fileName"]
        shutil.copy2(source, destination)
        if sha(destination) != clip["sha256"]:
            raise ValueError("copied content hash mismatch")
    result["asrScreen"]["screenedClips"] = 32
    result["asrScreen"]["note"] = "Selected from two independently transcribed runs; raw hypotheses retained. Limited script-variant/homophone explanations are post-transcription interpretation, never recognizer prompts."
    (SELECTED / "manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(SELECTED / "manifest.json")


if __name__ == "__main__": main()
