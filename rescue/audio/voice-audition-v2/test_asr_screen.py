import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("screen", Path(__file__).with_name("asr_screen.py"))
screen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(screen)


class ASRScreenTests(unittest.TestCase):
    def test_recognizer_has_no_expected_text_hints_or_cross_clip_context(self):
        settings = screen.transcribe_kwargs()
        for key in ("initial_prompt", "prefix", "hotwords"):
            self.assertIsNone(settings[key])
        self.assertFalse(settings["condition_on_previous_text"])
        self.assertEqual(settings["language"], "zh")

    def test_exact_spelling_never_auto_approves_pronunciation(self):
        status, note = screen.classify_transcript("十。", "十")
        self.assertEqual(status, "transcript-match-review")
        self.assertIn("unverified", note)

    def test_alternate_characters_remain_review_not_automatic_rejection(self):
        for transcript, expected in (("堂", "糖"), ("湯", "汤"), ("G", "鸡")):
            status, note = screen.classify_transcript(transcript, expected)
            self.assertEqual(status, "transcript-differs-review")
            self.assertIn("not an automatic rejection", note)

    def test_empty_output_does_not_certify_silence(self):
        status, note = screen.classify_transcript("…", "妈")
        self.assertEqual(status, "empty-transcript-review")
        self.assertIn("recognizer failure", note)


if __name__ == "__main__": unittest.main()
