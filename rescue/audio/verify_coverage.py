#!/usr/bin/env python3
"""Verify starter-cache completeness and file integrity; never phonetic correctness."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--curriculum", type=Path, default=HERE.parent / "content/curriculum.json")
    p.add_argument("--audio", type=Path, default=HERE.parent / "app/public/audio")
    p.add_argument("--provider", default="qwen")
    p.add_argument("--decode", action="store_true", help="Decode every required file with ffmpeg")
    p.add_argument("--report", type=Path, default=HERE / "coverage-report.json")
    args = p.parse_args()
    content = json.loads(args.curriculum.read_text())
    manifest = json.loads((args.audio / "manifest.json").read_text())
    indexed = collections.defaultdict(list)
    for clip in manifest["clips"]:
        if clip["provider"] == args.provider and clip.get("status") != "rejected":
            indexed[(clip["languageId"], clip["text"], clip["voiceId"])].append(clip)
    missing, duplicates, invalid, mismatches, duration_flags = [], [], [], [], []
    languages = []
    required = {}
    total_pairs = 0
    for lang in content["languages"]:
        pairs = [pair for contrast in lang["contrasts"] for pair in contrast["pairs"]]
        total_pairs += len(pairs)
        voices = [v["id"] for v in manifest["voicesByLanguage"].get(lang["id"], [])
                  if v.get("provider") == args.provider]
        if len(voices) != 2:
            invalid.append({"languageId": lang["id"], "issue": "expected exactly two voice profiles", "voices": voices})
        words = {word["text"]: word for pair in pairs for word in pair["words"]}
        complete_pairs = 0
        for pair in pairs:
            complete = True
            for word in pair["words"]:
                for voice in voices:
                    key = (lang["id"], word["text"], voice)
                    matches = indexed.get(key, [])
                    if not matches:
                        missing.append({"languageId": lang["id"], "pairId": pair["id"],
                                        "text": word["text"], "voiceId": voice})
                        complete = False
                    elif len(matches) > 1:
                        duplicates.append({"languageId": lang["id"], "text": word["text"],
                                           "voiceId": voice, "ids": [x["id"] for x in matches]})
                        complete = False
                    else:
                        clip = matches[0]
                        required[clip["id"]] = clip
                        if clip.get("targetIPA") != word.get("ipa"):
                            mismatches.append({"id": clip["id"], "text": word["text"],
                                               "targetIPA": word.get("ipa"), "clipIPA": clip.get("targetIPA")})
            complete_pairs += int(complete and len(voices) == 2)
        languages.append({"languageId": lang["id"], "pairs": len(pairs),
                          "uniqueWords": len(words), "voiceProfiles": len(voices),
                          "completePairs": complete_pairs})
    for clip in required.values():
        path = args.audio / "clips" / Path(clip["url"]).name
        if not path.exists():
            invalid.append({"id": clip["id"], "issue": "missing file"})
            continue
        if hashlib.sha256(path.read_bytes()).hexdigest() != clip["sha256"]:
            invalid.append({"id": clip["id"], "issue": "checksum mismatch"})
        if args.decode:
            result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"],
                                     capture_output=True, text=True)
            if result.returncode:
                invalid.append({"id": clip["id"], "issue": "decode failure", "detail": result.stderr[:200]})
        if clip.get("durationSeconds", 0) > 3:
            duration_flags.append({"id": clip["id"], "languageId": clip["languageId"],
                                   "text": clip["text"], "voiceId": clip["voiceId"],
                                   "durationSeconds": clip["durationSeconds"],
                                   "note": "Long for a short isolated word; listening review required"})
    report = {"provider": args.provider, "curriculumPairs": total_pairs,
              "requiredClipsFound": len(required), "languages": languages,
              "missing": missing, "duplicates": duplicates, "invalidFiles": invalid,
              "ipaMetadataMismatches": mismatches, "durationReviewFlags": duration_flags,
              "statusCounts": dict(collections.Counter(c["status"] for c in required.values())),
              "audioBytes": sum(c["bytes"] for c in required.values()),
              "decodingChecked": args.decode,
              "phoneticListeningVerified": False,
              "complete": not (missing or duplicates or invalid or mismatches)}
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in ("curriculumPairs", "requiredClipsFound", "complete", "statusCounts", "audioBytes")}, ensure_ascii=False))
    print("Missing:",len(missing),"Duplicates:",len(duplicates),"Invalid:",len(invalid),
          "IPA mismatches:",len(mismatches),"Duration review flags:",len(duration_flags))
    if not report["complete"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
