#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
PYTHON="$PWD/../.venv/bin/python"
mkdir -p private/logs
LOG="$PWD/private/logs/remaining-auditions-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
echo "Log: $LOG"
caffeinate -i "$PYTHON" -u create_remaining_voices.py
for bank in de es it zh pt ru ja; do
  caffeinate -i "$PYTHON" -u studio.py generate --provider chatterbox --bank "$bank" --voices 4 --execute
done
echo 'AUDITIONS COMPLETE — four voices per language. Listen before full-bank generation.'
