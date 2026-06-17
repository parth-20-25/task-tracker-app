#!/usr/bin/env bash
set -euo pipefail
trap 'rm -f -- "$0"' EXIT

listener_pid="$(fuser 5000/tcp 2>/dev/null | awk '{print $1}' || true)"
if [ -n "$listener_pid" ] && [ -r "/proc/$listener_pid/stat" ]; then
  parent_pid="$(awk '{print $4}' "/proc/$listener_pid/stat")"
  grandparent_pid=""
  if [ -n "$parent_pid" ] && [ "$parent_pid" -gt 1 ] && [ -r "/proc/$parent_pid/stat" ]; then
    grandparent_pid="$(awk '{print $4}' "/proc/$parent_pid/stat")"
  fi

  kill "$listener_pid" 2>/dev/null || true
  if [ -n "$parent_pid" ] && [ "$parent_pid" -gt 1 ]; then
    kill "$parent_pid" 2>/dev/null || true
  fi
  if [ -n "$grandparent_pid" ] && [ "$grandparent_pid" -gt 1 ]; then
    kill "$grandparent_pid" 2>/dev/null || true
  fi
fi

sleep 2
cd /var/www/parc-task-tracker/app/backend
nohup env NODE_ENV=production npm start \
  >> /var/www/parc-task-tracker/backend.log 2>&1 </dev/null &
echo "$!" > /var/www/parc-task-tracker/backend.pid

for _attempt in $(seq 1 60); do
  if curl --noproxy '*' --silent --fail http://127.0.0.1:5000/api/health >/dev/null; then
    exit 0
  fi
  sleep 1
done

echo "Backend did not become healthy within 60 seconds" >&2
exit 1
