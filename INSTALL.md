# Install Blip (instructions for Claude Code)

You are Claude Code, installing Blip for the person you are working with. Blip is a small character at the top of their screen that shows when Claude Code is working, needs them, is done, or hit an error. It has two parts: the Blip app (built from this repository) and the Blip plugin for Claude Code.

## Rules

- First, show the person the full list of steps below in plain words and ask whether to go ahead.
- Ask before every command that installs software, downloads something, or changes a settings file. Say what it does and roughly how long it takes.
- Do not change anything outside the Blip folder (`~/blip-notification` unless the person picks another place), `~/.blip`, and Claude Code's plugin settings.
- If a step fails, stop, explain the error in plain words, and suggest the fix. Do not try random changes.
- Blip works on macOS only for now. On Windows or Linux, stop and say so.

## Steps

1. **Check the system.** Confirm macOS (`uname -s` prints `Darwin`). Check for each tool and note what is missing:
   - Apple command line tools: `xcode-select -p`
   - git: `git --version`
   - Node.js 18 or later: `node --version`
   - Rust 1.85 or later: `rustc --version`. If it is not found, also try `"$HOME/.cargo/bin/rustc" --version`: Rust may be installed but not yet on this shell's path.
   - Claude Code's command line: `claude --version`. The plugin step needs it. People who only use the Claude Desktop app may not have it.
2. **Install what is missing**, one tool at a time, asking first:
   - Apple command line tools: `xcode-select --install` (opens a system dialog the person must accept).
   - Node.js: if Homebrew is installed, `brew install node`; otherwise point the person to https://nodejs.org and wait for them.
   - Rust: the official installer from https://rustup.rs, `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`. Each of your commands may start a fresh shell, so put `. "$HOME/.cargo/env" &&` in front of every later command that needs Rust, for example `. "$HOME/.cargo/env" && rustc --version`.
   - Rust older than 1.85: `rustup update` (Blip uses the Rust 2024 edition, which older versions cannot build).
   - Claude Code's command line: point the person to https://claude.com/claude-code and wait for them. Check again with `claude --version`.
3. **Download Blip.** Ask where to put it (default `~/blip-notification`), then:
   `git clone https://github.com/Mohamed-Shahzan/blip-notification.git ~/blip-notification`
4. **Install the app's packages.** `cd ~/blip-notification/app && npm install`
5. **Build and start the Blip app in the person's own Terminal.** Do not run it in your background: it would stop when this session ends, and Blip would disappear. Ask the person to open a new Terminal window (in the Terminal app, Cmd+N) and run:
   `cd ~/blip-notification/app && npm run tauri dev`
   The first build takes several minutes. It is ready when the output shows `Running` and the line `target/debug/blip`. Wait until they say it is ready, then check that Blip is listening: `lsof -nP -iTCP:47821 -sTCP:LISTEN` shows a `blip` line. Tell the person that Blip runs while that window stays open, and that next time only that command is needed.
6. **Install the Claude Code plugin**, asking first, since it changes Claude Code's user settings:
   - `claude plugin marketplace add Mohamed-Shahzan/blip-notification`
   - `claude plugin install blip@blip-notification`
   - Check: `claude plugin list` shows `blip@blip-notification` as enabled.
7. **Finish.** Tell the person:
   - The plugin takes effect in new sessions. In the Claude Desktop app, open a new session; in the Terminal, start `claude` again.
   - In the next session, Sprout appears at the top centre of the screen while Claude works, hops when it is done, and waves when Claude needs them. Right-click Sprout to hide the message text.
   - To uninstall: stop the app (`Ctrl+C` where it runs), run `claude plugin marketplace remove blip-notification`, then delete `~/blip-notification` and `~/.blip`.

## By hand (for a person, not Claude)

You need about 15 minutes. Skip any tool you already have.

1. Install the tools: Apple's command line tools (`xcode-select --install`), Rust 1.85 or later ([rustup.rs](https://rustup.rs), or `rustup update`), Node.js 18 or later ([nodejs.org](https://nodejs.org)) and [Claude Code](https://claude.com/claude-code).
2. Download Blip: `git clone https://github.com/Mohamed-Shahzan/blip-notification.git ~/blip-notification`
3. Build and start the app: `cd ~/blip-notification/app && npm install && npm run tauri dev`. The first build takes several minutes. Keep this Terminal window open, because Blip runs while it does. Next time only the last command is needed.
4. In a new Terminal window, connect Claude Code: `claude plugin marketplace add Mohamed-Shahzan/blip-notification`, then `claude plugin install blip@blip-notification`.
5. Start a new Claude Code session (in the Desktop app, open a new session) and ask anything. Sprout appears while Claude works.
