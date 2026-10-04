#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
../.venv/bin/python -u quality.py scan
printf '\nScan complete. Open Review Audio.command when ready.\n'
read -r -p 'Press Enter to close.'
