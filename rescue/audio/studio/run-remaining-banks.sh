#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
PYTHON="$PWD/../.venv/bin/python"
mkdir -p private/logs
LOG="$PWD/private/logs/remaining-banks-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
echo "Log: $LOG"
if [[ "${1:-}" != --check ]]; then
  echo 'Generate the seven remaining language banks locally in four voices each.'
  echo 'German, Spanish, Italian, Mandarin, Portuguese, Russian and Japanese. British English is excluded. Existing clips are reused; flags are saved for later.'
fi
for bank in de es it zh pt ru ja; do
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
if [[ "${1:-}" == --check ]]; then echo 'CHECK PASSED — no generation started.'; else echo 'ALL SEVEN BANKS COMPLETE — send Codex the log path above.'; fi
