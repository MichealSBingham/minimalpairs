"""Reproduce this isolated editorial candidate; never edits the main curriculum/audio."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DATE = "2026-09-28"
BASE = "https://www.collinsdictionary.com/us/dictionary/english/"
PUBLISHER = "Webster’s New World College Dictionary, 5th Digital Edition (2025), via Collins"
NORMALIZATION = "Webster American /r/ is represented as broad /ɹ/; /ɜr/ as rhotic /ɝ/. Whitespace is removed. No vowel-category substitution is made; Webster /u/ is retained without a length mark."

# Each transcription was read in the specified American Webster entry, not the
# separate Random House notation, British entry, proper name or abbreviation.
ROWS = [
    ("cook", "kʊk", ["k", "ʊ", "k"], "prepare food using heat", "cook in American English; common verb/noun"),
    ("kook", "kuk", ["k", "u", "k"], "an eccentric person (informal)", "kook in American English; informal US noun"),
    ("full", "fʊl", ["f", "ʊ", "l"], "filled to capacity", "full in American English 1; adjective"),
    ("fool", "ful", ["f", "u", "l"], "trick someone", "fool in American English 1; verb"),
    ("pull", "pʊl", ["p", "ʊ", "l"], "draw something toward you", "pull in American English; verb"),
    ("pool", "pul", ["p", "u", "l"], "a place for swimming", "pool in American English 1; noun"),
    ("bat", "bæt", ["b", "æ", "t"], "a flying mammal", "bat in American English 2; animal noun"),
    ("bet", "bɛt", ["b", "ɛ", "t"], "a wager", "bet in American English 1; wager noun, not the Hebrew-letter entry"),
    ("mat", "mæt", ["m", "æ", "t"], "a small floor covering", "mat in American English 1; noun"),
    ("met", "mɛt", ["m", "ɛ", "t"], "past tense of meet", "met in American English 1; past tense/participle"),
    ("bad", "bæd", ["b", "æ", "d"], "poor in quality", "bad in American English 1; adjective, not archaic verb"),
    ("bed", "bɛd", ["b", "ɛ", "d"], "furniture used for sleeping", "bed in American English; common noun, not BEd abbreviation"),
    ("vine", "vaɪn", ["v", "aɪ", "n"], "a plant with a climbing stem", "vine in American English; common noun"),
    ("wine", "waɪn", ["w", "aɪ", "n"], "an alcoholic drink made from grapes", "wine in American English; common noun"),
    ("vest", "vɛst", ["v", "ɛ", "s", "t"], "a sleeveless upper-body garment", "vest in American English; clothing noun"),
    ("west", "wɛst", ["w", "ɛ", "s", "t"], "the direction opposite east", "west in American English; direction noun, not surname West"),
    ("vet", "vɛt", ["v", "ɛ", "t"], "a veterinarian (informal)", "vet in American English 1; veterinarian noun"),
    ("wet", "wɛt", ["w", "ɛ", "t"], "covered with water", "wet in American English; adjective"),
    ("thin", "θɪn", ["θ", "ɪ", "n"], "having little thickness", "thin in American English; adjective"),
    ("fin", "fɪn", ["f", "ɪ", "n"], "a fish’s swimming appendage", "fin in American English 1; fish-organ noun, not French loanword fin"),
    ("three", "θri", ["θ", "ɹ", "i"], "the number 3", "three in American English; number"),
    ("free", "fri", ["f", "ɹ", "i"], "not under another person’s control", "free in American English; independent adjective, not suffix -free"),
    ("thirst", "θɜrst", ["θ", "ɝ", "s", "t"], "a need for a drink", "thirst in American English; noun"),
    ("first", "fɜrst", ["f", "ɝ", "s", "t"], "before the others in order", "first in American English; ordinal adjective"),
]

SPECS = [
    dict(id="en-foot-goose", path="/english/short-u-vs-long-oo", label="Full or fool?", phonemes=["ʊ", "u"], rows=(0, 6), target=1, oldLabel="short u vs long oo (/ʊ/ vs /uː/)", component="oN", description="Distinguish the vowels in full and fool. Listen to vowel quality; making a sound longer by itself does not establish the other category.", restrictions=["Use the selected American /ʊ–u/ citation forms. The legacy /uː/ label is represented as broad American /u/ here, not a new contrast.", "Two of the three pairs end in /l/. Approve each actual profile only if full/fool and pull/pool remain audibly distinct; the dictionary cannot guarantee a given voice’s realization.", "Kook is an informal, potentially disparaging noun. Teach its meaning neutrally, without describing the learner this way."]),
    dict(id="en-trap-dress", path="/english/ae-vs-e", label="Bat or bet?", phonemes=["æ", "ɛ"], rows=(6, 12), target=1, oldLabel="ae vs e (/æ/ vs /ɛ/)", component="QN", description="Compare the vowels in bat and bet while the surrounding consonants stay the same within each pair.", restrictions=["Target the selected American TRAP /æ/ and DRESS /ɛ/ citation forms; this is not an assertion that all English accents realize those vowels identically.", "The legacy route says e, but its own phonetic declaration is /ɛ/. Do not relabel this as FACE /eɪ/.", "Bat means the animal, met is the past tense of meet, and bet means a wager. These entries do not require a different spoken form for their selected meanings."]),
    dict(id="en-v-w", path="/english/v-vs-w", label="Vine or wine?", phonemes=["v", "w"], rows=(12, 18), target=0, oldLabel="v vs w (/v/ vs /w/)", component="MN", description="Focus on the first consonant in vine and wine, then compare it across other words.", restrictions=["Use selected American citation forms with distinct initial /v/ and /w/.", "All selected pairs match in the remainder of the word. Legacy very/wary was not reused; no claim is made about its dialect-specific suitability because those dictionary entries were not audited for this batch.", "Vet is the informal word for veterinarian. West is the direction, not a proper name."]),
    dict(id="en-th-f", path="/english/voiceless-th-vs-f", label="Thin or fin?", phonemes=["θ", "f"], rows=(18, 24), target=0, oldLabel="voiceless th vs f (/θ/ vs /f/)", component="bN", description="Match the first sound in thin or fin. The target is voiceless /θ/ versus /f/, including before another consonant in three and free.", restrictions=["Use the selected rhotic American citation forms. Thirst/first use /ɝ/ here; do not mix rhotic and non-rhotic readings within a profile.", "A recording that realizes target /θ/ as /f/ cannot represent two distinct answer categories for this lesson. This reference choice is not a judgment that another English variety is wrong.", "Fin is the fish-organ word /fɪn/, not the borrowed French word /fɛ̃/. Inspect the actual recording or synthesis response rather than assuming the spelling settles pronunciation.", "Three/free have /ɹ/ after the target. Their target is only the first consonant, with category-matched context within each pair."]),
]

def norm(ipa):
    return ipa.replace(" ", "").replace("ɜr", "ɝ").replace("r", "ɹ")

def dump(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")

def main():
    curriculum = json.loads((ROOT / "rescue/content/curriculum.json").read_text())
    legacy = json.loads((ROOT / "rescue/content/legacy-coverage.json").read_text())
    en = next(l for l in curriculum["languages"] if l["id"] == "en")
    existing_texts = {w["text"] for c in en["contrasts"] for p in c["pairs"] for w in p["words"]}
    words = {r[0]: dict(text=r[0], ipa=f"/{norm(r[1])}/", meaning=r[3], phonemes=r[2]) for r in ROWS}
    contrasts = []
    for s in SPECS:
        focus = "Listen to the vowel in the middle of each word." if s["target"] == 1 else "Listen to the first consonant in each word."
        pairs = []
        for i in range(*s["rows"], 2):
            a, b = ROWS[i][0], ROWS[i + 1][0]
            pairs.append(dict(id=f"en-{a}-{b}", words=[words[a], words[b]], kind="minimal", sources=[BASE + a, BASE + b], validation=dict(text="editor-curated", audio="pending-listening-review"), abx=dict(categoryByWordIndex=[0, 1], targetTokenIndex=s["target"], targetPosition="medial" if s["target"] else "initial", trialGroup="all")))
        contrasts.append(dict(id=s["id"], label=s["label"], phonemes=s["phonemes"], description=s["description"], l1Notes=[], pairs=pairs, sources=sorted({url for p in pairs for url in p["sources"]}), targetSoundFocus=focus, abx=dict(matchType="phoneme", targetSoundFocus=focus, prompt="Which reference shares X’s target sound?", categoryLabels=s["phonemes"], categoryOrder="words[0] is category 0; words[1] is category 1", xMustUseDifferentPair=True, xMustExcludeBothReferenceWordTexts=True, presentation="audio-only-until-answer-or-explicit-text-assist")))
    dump("candidates.json", dict(date=DATE, status="isolated-text-candidate-audio-unapproved", languageId="en", locale="en-US", dialect="Selected rhotic American English dictionary citation forms; recordings unreviewed", contrasts=contrasts))
    dump("source-audit.json", dict(date=DATE, source=PUBLISHER, retrieval="Primary dictionary American entries read through the web tool on 2026-09-28; meanings below are independently written brief labels. No dictionary recordings or definition paragraphs were acquired.", normalization=NORMALIZATION, words=[dict(word=r[0], referenceUrl=BASE+r[0], selectedEntry=r[4], source=PUBLISHER, retrievedUsIpa=[r[1]], editorialBroadIpa=norm(r[1]), sourceStatus="pronunciation-entry-read", audioStatus="not-listened") for r in ROWS], restrictionsByContrast={s["id"]:s["restrictions"] for s in SPECS}, rejectedCandidates=[dict(pair=["soot", "suit"], reason="The Webster American soot entry gives both /sʊt/ and /sut/. The latter erases the target contrast with /sut/ suit; no unconditional starter pair is asserted.", sources=[BASE+"soot",BASE+"suit"], retrievedUsIpa={"soot":["sʊt","sut"], "suit":["sut"]})]))
    dump("audio-request.json", dict(date=DATE, status="request-only-no-generation-authorized-by-this-artifact", languageId="en", locale="en-US", contrastIds=[s["id"] for s in SPECS], pairIds=[p["id"] for c in contrasts for p in c["pairs"]], requiredWords=list(words.values()), newWords=[w for t,w in words.items() if t not in existing_texts], reusedTextWords=sorted(set(words)&existing_texts), requestedProfilesPerWord=2, completeCollectionClipCount=len(words)*2, textNewClipCount=sum(t not in existing_texts for t in words)*2, reviewedApprovedClipCount=0, rules=["Acquire or generate two stable identifiable profiles that each cover every word of each chosen contrast; do not substitute arbitrary per-word speakers.", "Existing text or cached thin does not establish approved pronunciation, voice compatibility or reuse rights for a new collection.", "Do not mix distinct source collections or fall back silently for missing words. Audio is not ready merely because every filename exists.", "Keep the original lexical text; if disambiguating input is needed (for example fin), record the changed request and audit the actual response.", "Audit each exact take for word identity, both category realizations, accent, intelligibility, extra speech, clipping and category-correlated recording artifacts.", "This batch is not in the Google audition allowlist. Do not expand that tool, its scope or its budget from this request."], pronunciationReviewQuestions={s["id"]:s["restrictions"] for s in SPECS}))
    selected_paths = {s["path"] for s in SPECS}
    gsc_path = ROOT / "research/revenue-operation-2026-09-27.md"
    bundle_path = ROOT / "rescue/discovery/legacy-bundle.js"
    dump("selection-evidence.json", dict(date=DATE, sourceFiles={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/"rescue/content/legacy-coverage.json", ROOT/"rescue/content/curriculum.json",gsc_path,bundle_path]}, englishInventoryAtSelection=legacy["counts"]["en"], existingEnglishContrastIds=[c["id"] for c in en["contrasts"]], selectedLegacyRoutes=[r for r in legacy["routes"] if r["legacyPath"] in selected_paths], mappings=[dict(contrastId=s["id"], legacyPath=s["path"], legacyDeclaredLabel=s["oldLabel"], bundleComponent=s["component"], broadCategoryNormalization="Legacy /uː/ maps to American /u/; other selected category symbols are unchanged." if s["id"]=="en-foot-goose" else "No category substitution.") for s in SPECS], demandEvidence=dict(source="research/revenue-operation-2026-09-27.md", observationWindow="2026-06-26 through 2026-09-25", englishHub=dict(clicks=49, impressions=4711, latest28DayClicks=14), individuallyMeasuredEnglishTopicsAlreadyRestored=["en-zh-j","en-foot-strut","en-ae-strut"], selectedTopicMetrics=None, priorityBasis="Editorial restoration priority among missing legacy routes: familiar lexical examples, complementary vowel/consonant coverage and existing English hub visibility. Saved evidence does not rank these four routes by individual demand.", noForecastClaim=True)))

if __name__ == "__main__":
    main()
