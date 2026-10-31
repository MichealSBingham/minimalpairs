import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("candidate", Path(__file__).with_name("local_candidate.py"))
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


def word(ident="zh-ma1", text="妈"):
    return dict(wordId=ident, bankId="zh", languageId="zh", text=text,
                reading="mā", ipa="ma˥", meaning="mother")


class CandidateTests(unittest.TestCase):
    def test_preset_identity_is_stable_across_words_and_language_is_explicit(self):
        clips = candidate.plan_clips([word(), word("zh-ma2", "麻")], "/audition/clips")
        self.assertEqual(clips[0]["voiceId"], clips[2]["voiceId"])
        self.assertEqual(clips[1]["voiceId"], clips[3]["voiceId"])
        self.assertNotEqual(clips[0]["voiceId"], clips[1]["voiceId"])
        self.assertEqual({candidate.model_kwargs(c)["language"] for c in clips}, {"Chinese"})
        self.assertEqual({candidate.model_kwargs(c)["instruct"] for c in clips}, {None})
        self.assertEqual({c["reviewStatus"] for c in clips}, {"pending"})

    def test_content_or_model_change_cannot_silently_reuse_clip_identity(self):
        first = candidate.plan_clips([word()], "/audition")[0]
        changed = word(); changed["ipa"] = "changed"
        second = candidate.plan_clips([changed], "/audition")[0]
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(first["seed"], second["seed"])
        self.assertEqual(candidate.model_kwargs(first), candidate.model_kwargs(second))

    def test_selected_sidecar_ids_only_and_no_missing_or_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "words.json"
            data = dict(lexicalItems=[word(), word("zh-ma2", "麻")], audition=dict(wordIds=["zh-ma2"]))
            path.write_text(json.dumps(data))
            self.assertEqual([w["wordId"] for w in candidate.load_words(path)], ["zh-ma2"])
            for ids in (["missing"], ["zh-ma2", "zh-ma2"]):
                data["audition"]["wordIds"] = ids; path.write_text(json.dumps(data))
                with self.assertRaises(ValueError): candidate.load_words(path)

    def test_non_mandarin_and_excess_batch_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "words.json"
            bad = word(); bad["languageId"] = "en"
            for data in ([bad], [word(str(i)) for i in range(33)]):
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError): candidate.load_words(path)

    def test_heldout_word_is_rejected_even_if_accidentally_selected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "words.json"
            item = word(); item["split"] = "heldout"
            path.write_text(json.dumps([item]))
            with self.assertRaisesRegex(ValueError, "heldout"):
                candidate.load_words(path)

    def test_voice_design_or_changed_revision_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            config = dict(tts_model_type="custom_voice", talker_config=dict(spk_id=dict(vivian=1, uncle_fu=2)))
            provenance = dict(repo=candidate.REPO, revision=candidate.REVISION)
            for kind, revision in (("voice_design", candidate.REVISION), ("custom_voice", "changed")):
                config["tts_model_type"] = kind; provenance["revision"] = revision
                (folder / "config.json").write_text(json.dumps(config))
                (folder / "provenance.json").write_text(json.dumps(provenance))
                with self.assertRaises(ValueError): candidate.validate_model(folder)

    def test_repair_is_one_pass_on_only_technical_warnings_and_records_actual_text(self):
        clips = candidate.plan_clips([word()], "/original")
        clips[0].update(technicalStatus="needs-review", sha256="a" * 64)
        clips[1].update(technicalStatus="pass", sha256="b" * 64)
        original = dict(status="complete", modelRevision=candidate.REVISION, clips=clips)
        repaired = candidate.plan_clips([word()], "/repair", original)
        self.assertEqual(len(repaired), 1)
        self.assertEqual(repaired[0]["repairOfClipId"], clips[0]["id"])
        self.assertNotEqual(repaired[0]["id"], clips[0]["id"])
        self.assertEqual(candidate.model_kwargs(repaired[0])["text"], "妈。")
        self.assertEqual(repaired[0]["take"], 2)
        self.assertEqual(repaired[0]["reviewStatus"], "pending")
        original["repairOf"] = {"id": "previous"}
        with self.assertRaisesRegex(ValueError, "never another repair"):
            candidate.plan_clips([word()], "/repair2", original)


if __name__ == "__main__": unittest.main()
