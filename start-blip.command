#!/bin/zsh
# Copyright (c) 2026 Mohamed. All rights reserved. See LICENSE.
# Double-click to start Blip. Keep this Terminal window open: Blip runs while it does.
cd "$(dirname "$0")/app" && npm run tauri dev
