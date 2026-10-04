#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
PYTHON="$PWD/../.venv/bin/python"
mkdir -p private/logs
LOG="$PWD/private/logs/french-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
echo "Log: $LOG"
if [[ "${1:-}" != --check ]]; then
  echo 'Generate the four French voices from the audition.'
  echo 'Target: French 164 words × 4 voices = 656 recordings. Existing clips are reused.'
  read -r -p 'Type APPROVED to generate French: ' reply
  [[ "$reply" == APPROVED ]] || exit 0
fi
for bank in fr; do
  if [[ "${1:-}" == --check ]]; then
    "$PYTHON" studio.py generate --bank "$bank" --provider chatterbox --voices 4 --all-words
  else
    if ! caffeinate -i "$PYTHON" -u studio.py generate --bank "$bank" --provider chatterbox --voices 4 --all-words --execute; then
      echo "Stopped; completed clips remain saved. Send Codex this log: $LOG"
      exit 1
    fi
    "$PYTHON" completion.py --bank "$bank"
  fi
done
if [[ "${1:-}" == --check ]]; then echo 'CHECK PASSED — no generation started.'; else echo 'FRENCH COMPLETE — send Codex the log path above.'; fi
