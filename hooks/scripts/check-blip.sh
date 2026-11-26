#!/bin/sh
# Copyright (c) 2026 Mohamed. All rights reserved. See LICENSE at https://github.com/Mohamed-Shahzan/blip-notification
# At the start of a new session, reminds the user when the Blip app is not
# running (after a restart it does not start on its own yet). Runs as a sync
# SessionStart hook with a 1 s timeout, so Claude waits for it: it only looks
# at the process list (Mac about 0.03 s), never at the network. Silent when
# Blip runs or when the check itself fails. Always exits 0.
# Says it two ways (test, 27 Nov 2026): systemMessage shows in Terminal but
# not in the Claude app; additionalContext asks Claude to say it there.

cat >/dev/null 2>&1

case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*)
    # Windows (Git Bash). MSYS_NO_PATHCONV keeps /NH and /FI from being read as paths.
    list=$(MSYS_NO_PATHCONV=1 tasklist /NH /FI "IMAGENAME eq blip.exe" 2>/dev/null) || exit 0
    printf '%s\n' "$list" | grep -qi '^blip\.exe' && exit 0
    ;;
  *)
    # Mac. pgrep: 0 found, 1 not found, anything else is an error.
    pgrep -xi blip >/dev/null 2>&1
    status=$?
    [ "$status" -eq 1 ] || exit 0
    ;;
esac

msg="Blip is not running, so it can't tell you when Claude is done or needs you. To start it, open a terminal in your Blip folder and run: cd app && npm run tauri dev (on Windows PowerShell: npm.cmd if npm is blocked)."
printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Note from the Blip plugin: once, briefly, at the start of your first reply, tell the user this, then carry on with what they asked: %s"}}\n' "$msg" "$msg"
exit 0
