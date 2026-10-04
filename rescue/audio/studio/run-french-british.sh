#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
PYTHON="$PWD/../.venv/bin/python"
mkdir -p private/logs
LOG="$PWD/private/logs/french-british-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
echo "Log: $LOG"
if [[ "${1:-}" != --check ]]; then
  echo 'Run this after approving all four French and all four British voices.'
  echo 'Targets: French 164 × 4 = 656; British English 174 × 4 = 696. Existing clips are reused.'
  read -r -p 'Type APPROVED to generate both banks: ' reply
  [[ "$reply" == APPROVED ]] || exit 0
fi
for bank in fr en-GB-ssbe; do
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
if [[ "${1:-}" == --check ]]; then echo 'CHECK PASSED — no generation started.'; else echo 'BOTH BANKS COMPLETE — send Codex the log path above.'; fi
