"""Offline candidate checks. Dictionary readings remain a separate manual audit."""
import copy
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

def normalized(ipa):
    return ipa.replace(" ", "").replace("ɜr", "ɝ").replace("r", "ɹ")

def audit(candidate, sources, request, selection):
    errors, pair_checks = [], []
    def require(ok, message):
        if not ok:
            errors.append(message)
    require(candidate["status"] == "isolated-text-candidate-audio-unapproved", "candidate status must not imply audio approval")
    require(candidate["locale"] == "en-US", "unexpected target locale")
    require(len(candidate["contrasts"]) == 4, "expected four contrasts")
    lookup = {s["word"]:s for s in sources["words"]}
    require(len(lookup) == len(sources["words"]) == 24, "dictionary evidence requires 24 distinct words")
    all_words = {}
    pair_ids, contrast_ids = set(), set()
    existing_ids = set(selection["existingEnglishContrastIds"])
    selected_paths = {r["legacyPath"] for r in selection["selectedLegacyRoutes"] if r["status"] == "missing-contrast"}
    require(len(selected_paths) == 4, "selected routes must be missing in the captured authoritative inventory")
    for c in candidate["contrasts"]:
        require(c["id"] not in contrast_ids|existing_ids, f"repeated/restored contrast {c['id']}")
        contrast_ids.add(c["id"])
        require(len(c["pairs"]) >= 3, f"{c['id']}: fewer than three pairs")
        require(c["abx"]["categoryLabels"] == c["phonemes"], f"{c['id']}: contrast category labels differ")
        require(c["abx"]["xMustUseDifferentPair"] and c["abx"]["xMustExcludeBothReferenceWordTexts"], f"{c['id']}: cross-word constraints absent")
        for p in c["pairs"]:
            require(p["id"] not in pair_ids, f"duplicate pair {p['id']}")
            pair_ids.add(p["id"])
            require(p["kind"] == "minimal", f"{p['id']}: not minimal")
            require(p["validation"]["audio"] == "pending-listening-review", f"{p['id']}: unsupported audio validation")
            require(p["abx"]["categoryByWordIndex"] == [0,1], f"{p['id']}: category orientation reversed")
            a,b = p["words"]
            require(a["text"] != b["text"], f"{p['id']}: repeated word")
            target = p["abx"]["targetTokenIndex"]
            same_length = len(a["phonemes"]) == len(b["phonemes"])
            differences = [i for i,(x,y) in enumerate(zip(a["phonemes"],b["phonemes"])) if x != y]
            require(same_length and differences == [target], f"{p['id']}: not exactly the declared one-token substitution")
            for category,w in enumerate(p["words"]):
                require(0 <= target < len(w["phonemes"]), f"{p['id']}: target out of range")
                require(w["phonemes"][target] == c["phonemes"][category], f"{p['id']}: word/category target mismatch")
                require(''.join(w["phonemes"]) == w["ipa"].strip('/'), f"{w['text']}: tokens do not spell broad IPA")
                s = lookup.get(w["text"])
                require(s is not None, f"{w['text']}: missing dictionary evidence")
                if s:
                    require(w["ipa"].strip('/') in [normalized(x) for x in s["retrievedUsIpa"]], f"{w['text']}: IPA not supported by selected US entry")
                    require(s["editorialBroadIpa"] == w["ipa"].strip('/'), f"{w['text']}: editorial IPA differs")
                    expected_url = "https://www.collinsdictionary.com/us/dictionary/english/" + w["text"]
                    require(s["referenceUrl"] == expected_url and expected_url in p["sources"], f"{w['text']}: source URL mismatch")
                    require(s["sourceStatus"] == "pronunciation-entry-read" and "American English" in s["selectedEntry"], f"{w['text']}: missing selected American source entry")
                require(w["text"] not in all_words or all_words[w["text"]] == w, f"{w['text']}: conflicting word metadata")
                all_words[w["text"]] = w
            eligible = [q for q in c["pairs"] if q["id"] != p["id"] and not ({w["text"] for w in q["words"]} & {a["text"],b["text"]})]
            require(len(eligible) >= 2, f"{p['id']}: fewer than two other lexical pairs for X")
            pair_checks.append(dict(pairId=p["id"], differingTokenIndices=differences, targetTokenIndex=target, alternativePairCount=len(eligible)))
    require(set(all_words) == set(lookup), "source audit and candidate word sets differ")
    require({w["text"]:w for w in request["requiredWords"]} == all_words, "audio request word/IPA/meaning inventory differs")
    require(request["requestedProfilesPerWord"] == 2 and request["completeCollectionClipCount"] == 48, "audio request must require complete two-profile coverage")
    require(request["reviewedApprovedClipCount"] == 0, "unsupported reviewed audio claim")
    require(set(request["contrastIds"]) == contrast_ids and set(request["pairIds"]) == pair_ids, "request scope mismatch")
    require(set(request["reusedTextWords"]) == {"thin"}, "unexpected text reuse inventory")
    require({w["text"] for w in request["newWords"]} == set(all_words)-{"thin"}, "new-word inventory mismatch")
    require(request["textNewClipCount"] == 46, "new-word profile clip count mismatch")
    return dict(passed=not errors, errors=errors, contrasts=len(contrast_ids), pairs=len(pair_ids), words=len(all_words), requiredProfileClips=48, dictionaryWordEvidence=len(lookup), pairChecks=pair_checks, limitation="Offline checks validate declared source-to-IPA mapping, category orientation and inventory. They do not independently verify the dictionary readings, pronunciation, speaker consistency, recordings, SEO ranking or learning efficacy.")

def main():
    names = ["candidates.json","source-audit.json","audio-request.json","selection-evidence.json"]
    values = [json.loads((HERE/name).read_text()) for name in names]
    result = audit(*values)
    mutations = []
    def rejected(name, change):
        altered = copy.deepcopy(values)
        change(altered)
        check = audit(*altered)
        mutations.append(dict(name=name, rejected=not check["passed"]))
        if check["passed"]:
            result["errors"].append("Mutation was not rejected: " + name)
    rejected("reversed word/category orientation", lambda v:v[0]["contrasts"][0]["pairs"][0]["words"].reverse())
    rejected("second non-target phoneme difference", lambda v:v[0]["contrasts"][0]["pairs"][0]["words"][1]["phonemes"].__setitem__(2,"t"))
    rejected("dictionary reading inconsistent with pair", lambda v:v[1]["words"][0].__setitem__("retrievedUsIpa",["kuk"]))
    rejected("missing word in requested audio", lambda v:v[2]["requiredWords"].pop())
    rejected("invented audio approval", lambda v:v[0]["contrasts"][0]["pairs"][0]["validation"].__setitem__("audio","verified"))
    result.update(date="2026-09-28", mutationChecks=mutations, inputSha256={n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in names})
    result["passed"] = not result["errors"]
    (HERE/"validation.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({k:v for k,v in result.items() if k not in {"pairChecks","inputSha256"}},ensure_ascii=False,indent=2))
    raise SystemExit(0 if result["passed"] else 1)

if __name__ == "__main__":
    main()
