#!/bin/zsh
# Double-click to start Blip. Keep this Terminal window open: Blip runs while it does.
cd "$(dirname "$0")/app" && npm run tauri dev
