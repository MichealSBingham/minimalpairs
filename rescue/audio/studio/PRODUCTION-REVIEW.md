# Owner review of the live listening library

The review server at port 63122 now supports:

- `/?scope=production&bank=en-US-ga`: unfinished live recordings, customer reports and high machine flags first.
- `/?scope=production-high&bank=fr`: only high-priority live recordings.
- `/?scope=production-all&bank=fr`: listen through live recordings including previous passes. A browser-session sweep keeps reviewed clips from immediately repeating; “Listen again from the beginning” resets that sweep, not saved decisions.

Omit `bank` for all languages. Pass/Reject saves automatically to `private/quality.sqlite3`, bound to the exact clip ID and audio SHA. The page advances only after the server confirms the save. Rejections disappear from the live review queue immediately; publishing their removal remains a separate operator action. This screen does not claim that a rejection is already removed from the public website.

## Refresh after a production release

Run `python3 rescue/audio/studio/sync_production_review.py` from the repository root **after** the release succeeds. This fetches all nine current listening manifests from minimalpairs.co and atomically saves an ignored private snapshot, including retrieval time and manifest hashes. It never uses development manifests as evidence of production membership.

The queue intersects exact deployed clip IDs/hashes with the local scan. Audio playback and decisions independently verify the local file's full SHA. Missing local clips are reported, not silently substituted. Candidate recordings, superseded hashes, rejected clips and entries in `private/production-review-exclusions.json` are excluded. Refresh the local signal scan when new clips were generated, then sync the production inventory again. Old US Voice A must never be placed in the replacement review queue just because a historical local file remains.

The snapshot is deliberately not re-fetched on every browser request. The daily operator should refresh it after deployments. The visible library timestamp identifies the snapshot being reviewed.

## Seven-day owner plan

Begin after Candidate F validation and deployment. Existing passes count toward completion; use the include-passed option for another listen.

1. October 8: American English.
2. October 9: French.
3. October 10: Japanese.
4. October 11: Mandarin.
5. October 12: German and Portuguese.
6. October 13: Spanish and Italian.
7. October 14: Russian.

There are nine current production language banks, so two days combine languages to fit one week. British English is not part of this production manifest set. Start each language with priority flags, then continue its unfinished live library. Machine flags are suspicions, not pronunciation verdicts. Break larger days into short sessions; saved decisions survive restarting the local server.
