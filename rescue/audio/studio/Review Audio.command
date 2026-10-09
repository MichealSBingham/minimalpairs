#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
../.venv/bin/python -u quality.py review --port 63122
