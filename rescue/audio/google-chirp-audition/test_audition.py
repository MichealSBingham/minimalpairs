"""Offline fixture tests. No Google credential access or provider requests."""
import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("audition", HERE / "audition.py")
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


class FixtureTransport:
    def __init__(self, audio, fail_at=None, invalid=False, missing_voice=False):
        self.audio, self.fail_at, self.invalid, self.missing_voice = audio, fail_at, invalid, missing_voice
        self.synthesis_calls, self.catalog_calls = [], 0

    def catalog(self):
        self.catalog_calls += 1
        if self.missing_voice:
            return {"voices": []}
        return {"voices": [{"name": a.voice(lang, name)["providerVoice"], "languageCodes": [locale]}
                           for lang, locale in a.LOCALES.items() for name in ("Aoede", "Charon")]}

    def synthesize(self, request):
        self.synthesis_calls.append(request)
        if self.fail_at == len(self.synthesis_calls):
            raise TimeoutError("Do not leak secret-fixture-token")
        return {"audioContent": "!!bad-base64!!" if self.invalid else base64.b64encode(self.audio).decode()}


class AuditionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.selection = a.load_selection()
        # A locally synthesized tone tests codec plumbing, never linguistic quality.
        cls.tone = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                                  "sine=frequency=440:duration=0.4:sample_rate=24000",
                                  "-ac", "1", "-codec:a", "libmp3lame", "-f", "mp3", "-"],
                                 check=True, capture_output=True).stdout

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "candidate"
        budget_patch = patch.object(a, "BUDGET_DIR", Path(self.temp.name) / "private")
        budget_patch.start()
        self.addCleanup(budget_patch.stop)

    def plan(self, selected=None):
        return a.make_plan(self.selection, selected or ["en"], self.root, a.AUTHORIZED_PROJECT)

    def run_fixture(self, transport, selected=None):
        plan, _ = self.plan(selected)
        return a.execute(self.selection, selected or ["en"], self.root, a.AUTHORIZED_PROJECT, plan["planSha256"],
                         transport_factory=lambda project: transport)

    def test_default_is_no_network_credentials_or_writes(self):
        with patch.object(a, "HERE", Path(self.temp.name)), \
             patch.object(a, "GoogleTransport", side_effect=AssertionError("credentials accessed")), \
             patch.object(a.urllib.request, "urlopen", side_effect=AssertionError("network used")), \
             patch.object(a.subprocess, "run", side_effect=AssertionError("credential process used")), \
             patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(a.main([]), 0)
        plan = json.loads(output.getvalue())
        self.assertEqual(plan["counts"]["newRequests"], 8)
        self.assertFalse(self.root.exists())

    def test_all_languages_exact_two_profiles_two_pairs(self):
        plan, jobs = self.plan(list(a.LOCALES))
        self.assertEqual(len(jobs), 64)
        self.assertEqual(len({j["cacheKey"] for j in jobs}), 64)
        for lang, locale in a.LOCALES.items():
            subset = [j for j in jobs if j["languageId"] == lang]
            self.assertEqual(len(subset), 8)
            self.assertEqual(len({j["pairId"] for j in subset}), 2)
            self.assertEqual({j["voice"]["name"] for j in subset}, {"Aoede", "Charon"})
            self.assertEqual({j["locale"] for j in subset}, {locale})
        self.assertEqual(next(j for j in jobs if j["languageId"] == "es")["curriculumLocale"], "es-MX")
        self.assertGreater(plan["utf8BytesToSynthesize"], plan["charactersToSynthesize"])
        self.assertEqual(plan["assumedFreeQuota"], 0)

    def test_unknown_and_duplicate_languages_rejected(self):
        for selected in ["en,en", "xx", "", "en,xx", "all,en"]:
            with self.assertRaises(ValueError):
                a.languages(selected)

    def test_allowlist_rejects_substitutions_partial_pairs_and_overrides(self):
        for mutation in ("text", "pairs", "override"):
            data = copy.deepcopy(self.selection)
            if mutation == "text": data["scopes"][0]["pairs"][0]["words"][0]["text"] = "arbitrary speech"
            if mutation == "pairs": data["scopes"][0]["pairs"].pop()
            if mutation == "override": data["scopes"][0]["pairs"][0]["words"][0]["ttsText"] = "Say a different word."
            path = Path(self.temp.name) / "selection.json"
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError): a.load_selection(path)

    def test_cache_identity_binds_content_voice_locale_model_and_settings(self):
        _, jobs = self.plan()
        original = jobs[0]["settings"]
        variants = []
        for key, value in [("model", "different-model"), ("modelRevision", "different-revision")]:
            variant = copy.deepcopy(original); variant[key] = value; variants.append(variant)
        for section, key, value in [("input", "text", "sheep"), ("voice", "name", "en-US-Chirp3-HD-Charon"),
                                    ("voice", "languageCode", "en-GB"), ("audioConfig", "sampleRateHertz", 48000)]:
            variant = copy.deepcopy(original); variant["request"][section][key] = value; variants.append(variant)
        self.assertTrue(all(a.digest(variant) != jobs[0]["cacheKey"] for variant in variants))

    def test_character_budget_rejected_before_network(self):
        with self.assertRaises(ValueError): a.make_plan(self.selection, ["en"], self.root, max_characters=1)
        for limit in [0, -1, a.MAX_CHARACTERS + 1]:
            with self.assertRaises(ValueError): a.make_plan(self.selection, ["en"], self.root, max_characters=limit)

    def test_wrong_plan_hash_never_constructs_transport(self):
        factory = lambda _: self.fail("constructed transport")
        with self.assertRaises(ValueError):
            a.execute(self.selection, ["en"], self.root, a.AUTHORIZED_PROJECT, "bad", transport_factory=factory)

    def test_execute_requires_attestation_project_and_hash(self):
        with patch.object(a, "HERE", Path(self.temp.name)), patch("sys.stdout", new_callable=io.StringIO), \
             patch("sys.stderr", new_callable=io.StringIO), patch.object(a, "execute") as execute:
            self.assertEqual(a.main(["--execute"]), 1)
            execute.assert_not_called()

    def test_missing_catalog_voice_stops_before_synthesis(self):
        transport = FixtureTransport(self.tone, missing_voice=True)
        with self.assertRaises(ValueError): self.run_fixture(transport)
        self.assertEqual(transport.synthesis_calls, [])
        self.assertFalse((self.root / "attempts").exists())

    def test_cached_rerun_makes_zero_network_calls_and_has_safe_manifest(self):
        transport = FixtureTransport(self.tone)
        manifest = self.run_fixture(transport)
        self.assertEqual(len(transport.synthesis_calls), 8)
        self.assertEqual(len(manifest["clips"]), 8)
        self.assertEqual(len(manifest["completeScopes"]), 1)
        for clip in manifest["clips"]:
            self.assertTrue(clip["synthetic"])
            self.assertEqual(clip["status"], "generated-unreviewed")
            self.assertFalse(clip["phoneticListeningVerified"])
            self.assertFalse(clip["speakerConsistencyVerified"])
            self.assertEqual(clip["settings"]["request"]["input"]["text"], clip["text"])
            self.assertTrue(clip["url"].startswith(a.URL_PREFIX))
        plan, _ = self.plan()
        a.execute(self.selection, ["en"], self.root, a.AUTHORIZED_PROJECT, plan["planSha256"],
                  transport_factory=lambda _: self.fail("cached replay used network"))

    def test_timeout_stops_batch_and_future_rerun_without_duplicate_post(self):
        transport = FixtureTransport(self.tone, fail_at=2)
        with self.assertRaisesRegex(RuntimeError, "No automatic retry") as error: self.run_fixture(transport)
        self.assertNotIn("secret-fixture-token", str(error.exception))
        self.assertEqual(len(transport.synthesis_calls), 2)
        plan, _ = self.plan()
        self.assertEqual(plan["counts"], {"selected": 8, "cached": 1, "newRequests": 6, "blocked": 1})
        manifest = json.loads((self.root / "manifest.candidate.json").read_text())
        self.assertEqual(len(manifest["clips"]), 1)
        self.assertEqual(manifest["completeScopes"], [])
        with self.assertRaises(ValueError): self.run_fixture(transport)
        self.assertEqual(len(transport.synthesis_calls), 2)

    def test_interrupted_started_attempt_is_never_resubmitted(self):
        _, jobs = self.plan()
        _, _, attempt = a.paths(self.root, jobs[0]["cacheKey"])
        a.atomic_json(attempt, {"state": "started"})
        transport = FixtureTransport(self.tone)
        with self.assertRaises(ValueError): self.run_fixture(transport)
        self.assertEqual(transport.catalog_calls, 0)

    def test_invalid_response_blocks_retry(self):
        transport = FixtureTransport(self.tone, invalid=True)
        with self.assertRaises(RuntimeError): self.run_fixture(transport)
        self.assertEqual(len(transport.synthesis_calls), 1)
        self.assertEqual(self.plan()[0]["counts"]["blocked"], 1)
        with self.assertRaises(ValueError): self.run_fixture(transport)
        self.assertEqual(len(transport.synthesis_calls), 1)

    def test_non_audio_response_is_not_admitted_to_manifest(self):
        transport = FixtureTransport(b"not-an-mp3")
        with self.assertRaises(RuntimeError): self.run_fixture(transport)
        manifest = json.loads((self.root / "manifest.candidate.json").read_text())
        self.assertEqual(manifest["clips"], [])

    def test_corrupt_cached_file_blocks_instead_of_regenerating(self):
        self.run_fixture(FixtureTransport(self.tone))
        _, jobs = self.plan()
        audio, _, _ = a.paths(self.root, jobs[0]["cacheKey"])
        audio.write_bytes(b"corrupt")
        transport = FixtureTransport(self.tone)
        with self.assertRaises(ValueError): self.run_fixture(transport)
        self.assertEqual(transport.catalog_calls, 0)

    def test_store_rejects_public_output_and_symlink(self):
        with self.assertRaises(ValueError): a.validate_store(Path(self.temp.name) / "public" / "audio")
        self.root.mkdir()
        (self.root / "clips").symlink_to(Path(self.temp.name))
        with self.assertRaises(ValueError): a.validate_store(self.root)

    def test_transport_error_does_not_echo_provider_body_or_credential(self):
        with patch.dict(a.os.environ, {"GOOGLE_OAUTH_ACCESS_TOKEN": "secret-fixture-token"}), \
             patch.object(a.urllib.request, "build_opener") as factory:
            factory.return_value.open.side_effect = a.urllib.error.HTTPError(
                "https://example.invalid", 401, "secret-fixture-token", {}, io.BytesIO(b"secret-fixture-token"))
            transport = a.GoogleTransport(a.AUTHORIZED_PROJECT)
            with self.assertRaisesRegex(RuntimeError, "HTTP 401") as error: transport.catalog()
            self.assertNotIn("secret-fixture-token", str(error.exception))

    def seed_prior_budget(self, characters):
        data = a.initialize_budget(self.root, a.AUTHORIZED_PROJECT)
        data["reservations"][a.digest("historical-fixture-request")] = {
            "characterUpperBound": characters, "reservedUsdMicros": characters * 30,
            "state": "outcome-needs-review", "requestSha256": a.digest("historical-request")}
        a.atomic_json(a.BUDGET_DIR / "budget-ledger.json", data)

    def test_cumulative_cap_prevents_new_batch_before_any_network(self):
        self.seed_prior_budget(33330)  # $0.99990 reserved, only $0.00010 remains.
        plan, _ = self.plan()
        self.assertFalse(plan["cumulativeBudget"]["fits"])
        self.assertEqual(plan["cumulativeBudget"]["remainingUsd"], 0.0001)
        transport = FixtureTransport(self.tone)
        with self.assertRaisesRegex(ValueError, "Cumulative"):
            self.run_fixture(transport)
        self.assertEqual(transport.catalog_calls, 0)
        self.assertEqual(transport.synthesis_calls, [])

    def test_reservation_is_durable_before_the_post_and_failed_charge_stays(self):
        test = self
        class CheckingTransport(FixtureTransport):
            def synthesize(self, request):
                ledger = json.loads((a.BUDGET_DIR / "budget-ledger.json").read_text())
                reservations = list(ledger["reservations"].values())
                test.assertEqual(len(reservations), 1)
                test.assertEqual(reservations[0]["state"], "reserved")
                test.assertEqual(reservations[0]["reservedUsdMicros"], len(request["input"]["text"].encode()) * 30)
                return super().synthesize(request)
        transport = CheckingTransport(self.tone, fail_at=1)
        with self.assertRaises(RuntimeError): self.run_fixture(transport)
        ledger = a.load_budget(self.root, a.AUTHORIZED_PROJECT)
        reservation = next(iter(ledger["reservations"].values()))
        self.assertEqual(reservation["state"], "outcome-needs-review")
        self.assertEqual(reservation["reservedUsdMicros"], 120)  # ship: 4 bytes.
        self.assertEqual(self.plan()[0]["cumulativeBudget"]["reservedUsd"], .00012)

    def test_restart_and_changed_candidate_path_cannot_create_fresh_allowance(self):
        transport = FixtureTransport(self.tone, fail_at=1)
        with self.assertRaises(RuntimeError): self.run_fixture(transport)
        other = Path(self.temp.name) / "other-candidate"
        plan, _ = a.make_plan(self.selection, ["en"], other, a.AUTHORIZED_PROJECT)
        self.assertEqual(plan["counts"]["blocked"], 1)
        self.assertEqual(plan["cumulativeBudget"]["reservedUsd"], .00012)
        with self.assertRaises(ValueError):
            a.execute(self.selection, ["en"], other, a.AUTHORIZED_PROJECT, plan["planSha256"],
                      transport_factory=lambda _: self.fail("restart sent network request"))

    def test_successful_cache_rerun_reserves_zero_additional_spend(self):
        self.run_fixture(FixtureTransport(self.tone))
        before = (a.BUDGET_DIR / "budget-ledger.json").read_bytes()
        plan, _ = self.plan()
        self.assertEqual(plan["cumulativeBudget"]["newBatchReservationUsd"], 0)
        a.execute(self.selection, ["en"], self.root, a.AUTHORIZED_PROJECT, plan["planSha256"],
                  transport_factory=lambda _: self.fail("cached replay used network"))
        self.assertEqual((a.BUDGET_DIR / "budget-ledger.json").read_bytes(), before)

    def test_deleted_ledger_is_not_silently_recreated(self):
        a.initialize_budget(self.root, a.AUTHORIZED_PROJECT)
        (a.BUDGET_DIR / "budget-ledger.json").unlink()
        with self.assertRaisesRegex(ValueError, "silent reset"):
            self.plan()
        self.assertFalse((a.BUDGET_DIR / "budget-ledger.json").exists())

    def test_project_switch_and_production_project_rejected(self):
        for project in ["minimalpairs", "other-project"]:
            with self.assertRaises(ValueError):
                a.make_plan(self.selection, ["en"], self.root, project)

    def test_character_estimate_and_conservative_reservation_are_distinct(self):
        plan, _ = self.plan(list(a.LOCALES))
        self.assertEqual(plan["charactersToSynthesize"], 238)
        self.assertEqual(plan["listPriceEstimateUsdNoFreeQuota"], .00714)
        self.assertEqual(plan["cumulativeBudget"]["newBatchReservationUsd"], .00846)

    def test_uncertain_old_reservations_count_when_new_language_runs(self):
        transport = FixtureTransport(self.tone, fail_at=1)
        with self.assertRaises(RuntimeError): self.run_fixture(transport)
        prior = self.plan(["fr"])[0]["cumulativeBudget"]["reservedUsd"]
        self.run_fixture(FixtureTransport(self.tone), ["fr"])
        ledger = a.load_budget(self.root, a.AUTHORIZED_PROJECT)
        self.assertEqual(len(ledger["reservations"]), 9)
        self.assertGreater(self.plan(["fr"])[0]["cumulativeBudget"]["reservedUsd"], prior)
        self.assertEqual(sum(r["state"] == "outcome-needs-review" for r in ledger["reservations"].values()), 1)

    def test_direct_reservation_checks_cap_again_after_preflight(self):
        self.seed_prior_budget(33332)  # $0.99996; a 4-character request costs more.
        _, jobs = self.plan()
        before = (a.BUDGET_DIR / "budget-ledger.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "Cumulative"):
            a.reserve_charge(self.root, a.AUTHORIZED_PROJECT, jobs[0])
        self.assertEqual((a.BUDGET_DIR / "budget-ledger.json").read_bytes(), before)

    def test_shared_budget_lock_prevents_concurrent_writer(self):
        a.BUDGET_DIR.mkdir()
        with (a.BUDGET_DIR / ".budget.lock").open("a") as held:
            a.fcntl.flock(held, a.fcntl.LOCK_EX | a.fcntl.LOCK_NB)
            transport = FixtureTransport(self.tone)
            with self.assertRaises(BlockingIOError): self.run_fixture(transport)
            self.assertEqual(transport.catalog_calls, 0)

    def test_changed_ledger_invalidates_approved_plan(self):
        plan, jobs = self.plan()
        a.initialize_budget(self.root, a.AUTHORIZED_PROJECT)
        a.reserve_charge(self.root, a.AUTHORIZED_PROJECT, jobs[0])
        with self.assertRaisesRegex(ValueError, "Plan changed"):
            a.execute(self.selection, ["en"], self.root, a.AUTHORIZED_PROJECT, plan["planSha256"],
                      transport_factory=lambda _: self.fail("stale plan used network"))


if __name__ == "__main__":
    unittest.main()
