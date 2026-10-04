#!/bin/bash
# Run from any directory. All synthesis is local; no cloud credits are used.
set -euo pipefail
STUDIO_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$STUDIO_DIR"
PYTHON="$STUDIO_DIR/../.venv/bin/python"
MODE="${1:-run}"
if [[ "$MODE" != run && "$MODE" != --check ]]; then
  echo 'Usage: bash run-english.sh [--check]'
  exit 2
fi
if [[ ! -x "$PYTHON" ]]; then
  echo 'Local Python environment missing. Send this message to Codex.'
  exit 1
fi
mkdir -p private/logs
LOG="$STUDIO_DIR/private/logs/english-$(date +%Y%m%d-%H%M%S)-$$.log"
exec > >(tee -a "$LOG") 2>&1
echo "Log: $LOG"
"$PYTHON" studio.py init
if [[ "$MODE" == --check ]]; then
  "$PYTHON" studio.py generate --provider chatterbox --bank en-US-ga --voices 4 --all-words
  echo 'CHECK PASSED — no new recordings generated.'
  exit 0
fi
echo 'Generating 250 American-English words in four Chatterbox voices.'
echo 'Leave this Terminal window open and your Mac plugged in, with its lid open.'
echo 'Completed recordings are reused. Press Control-C to stop.'
if /usr/bin/caffeinate -i "$PYTHON" -u studio.py generate --provider chatterbox --bank en-US-ga --voices 4 --all-words --execute; then
  "$PYTHON" completion.py
  echo "Send Codex: English batch finished. Log: $LOG"
else
  RESULT=$?
  echo "BATCH STOPPED (exit $RESULT). Completed clips are saved."
  echo "Send Codex this log path: $LOG"
  exit "$RESULT"
fi
