#!/bin/sh
# Old name of send-event.sh. A session keeps the hooks it loaded at its start,
# so sessions opened before the Phase 1 bridge still call this. Remove once no
# session that old is left on either machine.
exec "$(dirname "$0")/send-event.sh"
