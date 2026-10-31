#!/bin/bash
# User-invoked local launcher. No startup service, public binding or paid API.
cd -- "$(dirname -- "$0")" || exit 1
lab_url='http://127.0.0.1:8767'
if /usr/bin/curl --silent --fail --max-time 2 "$lab_url/api/config" >/dev/null; then
  /usr/bin/open "$lab_url"
  exit 0
fi
if [[ ! -x .venv/bin/python ]]; then
  printf '%s\n' 'The local speech environment is missing. Open this project in Codex to restore it.'
  read -r -p 'Press Return to close.'
  exit 1
fi
.venv/bin/python speaking_server.py &
lab_pid=$!
trap 'kill "$lab_pid" 2>/dev/null' EXIT INT TERM
for attempt in {1..30}; do
  if /usr/bin/curl --silent --fail --max-time 1 "$lab_url/api/config" >/dev/null; then
    /usr/bin/open "$lab_url"
    printf '%s\n' 'Speaking Lab is open. Keep this window open while using it.'
    wait "$lab_pid"
    exit $?
  fi
  kill -0 "$lab_pid" 2>/dev/null || break
  sleep 1
done
printf '%s\n' 'The local server did not start. Review the message above or ask Codex to check it.'
read -r -p 'Press Return to close.'
