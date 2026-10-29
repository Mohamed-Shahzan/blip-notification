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
   - Rust: `cargo --version`
2. **Install what is missing**, one tool at a time, asking first:
   - Apple command line tools: `xcode-select --install` (opens a system dialog the person must accept).
   - Node.js: if Homebrew is installed, `brew install node`; otherwise point the person to https://nodejs.org and wait for them.
   - Rust: the official installer from https://rustup.rs, `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`, then `source "$HOME/.cargo/env"`.
3. **Download Blip.** Ask where to put it (default `~/blip-notification`), then:
   `git clone https://github.com/Mohamed-Shahzan/blip-notification.git ~/blip-notification`
4. **Install the app's packages.** `cd ~/blip-notification/app && npm install`
5. **Build and start the Blip app.** Run `npm run tauri dev` in `~/blip-notification/app` in the background, since it keeps running. The first build takes several minutes. It is ready when the output shows `Running` and the line `target/debug/blip`. Tell the person that Blip runs while this keeps running, and that to start it again later they run `cd ~/blip-notification/app && npm run tauri dev` in a Terminal window.
6. **Install the Claude Code plugin**, asking first, since it changes Claude Code's user settings:
   - `claude plugin marketplace add Mohamed-Shahzan/blip-notification`
   - `claude plugin install blip@blip-notification`
   - Check: `claude plugin list` shows `blip@blip-notification` as enabled.
7. **Finish.** Tell the person:
   - The plugin takes effect in new sessions. In the Claude Desktop app, open a new session; in the Terminal, start `claude` again.
   - In the next session, Sprout appears at the top centre of the screen while Claude works, hops when it is done, and waves when Claude needs them. Right-click Sprout to hide the message text.
   - To uninstall: stop the app (`Ctrl+C` where it runs), run `claude plugin marketplace remove blip-notification`, then delete `~/blip-notification` and `~/.blip`.
