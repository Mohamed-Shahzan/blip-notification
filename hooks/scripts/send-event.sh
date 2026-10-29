#!/bin/sh
# Sends one hook event (JSON on stdin) to Blip on 127.0.0.1. Runs as an async
# hook, so Claude never waits for it. curl gives up after 2 s because Claude
# Code does not enforce `timeout` on async command hooks. Always exits 0.

# The session's process, so Blip can walk up to the app the session runs in.
# Git Bash numbers its own processes; /proc/<pid>/winpid holds the Windows one.
pid=$PPID
winpid=$(cat "/proc/$PPID/winpid" 2>/dev/null)
# When it was sent, so events that reach a frozen Blip late are still put in order.
ts=$(date +%s)
url="http://127.0.0.1:${BLIP_PORT:-47821}/hook?pid=$pid${winpid:+&winpid=$winpid}&ts=$ts"

curl -s -m 2 -o /dev/null --data-binary @- -H 'Content-Type: application/json' "$url" 2>/dev/null
exit 0
