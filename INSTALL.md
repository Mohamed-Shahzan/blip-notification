# Install Blip (instructions for Claude Code)

You are Claude Code, installing Blip for the person you are working with. Blip is a small character at the top of their screen that shows when Claude Code is working, needs them, is done, or hit an error. It has two parts: the Blip app (built from this repository) and the Blip plugin for Claude Code.

## Rules

- First, show the person the full list of steps below in plain words and ask whether to go ahead.
- Ask before every command that installs software, downloads something, or changes a settings file. Say what it does and roughly how long it takes.
- Do not change anything outside the Blip folder (`~/blip-notification` unless the person picks another place), `~/.blip`, and Claude Code's plugin settings. On Windows `~` is the person's user folder (`$HOME`, usually `C:\Users\<name>`).
- If a step fails, stop, explain the error in plain words, and suggest the fix. Do not try random changes.
- One exception: if a download drops partway (for example `git clone` says "early EOF" or that the server closed the connection), delete any half-made folder and try once more. If it fails again, stop and explain.
- Blip works on macOS and Windows. First find out which one: `uname -s` prints `Darwin` on a Mac and starts with `MINGW` or `MSYS` in Git Bash on Windows; in PowerShell, `$env:OS` prints `Windows_NT`. On a Mac follow "Steps (Mac)", on Windows "Steps (Windows)". Inside WSL (`uname -s` prints `Linux` on a Windows PC) or Cygwin, stop and ask the person to run Claude Code on Windows itself (the Claude app, PowerShell or Git Bash). On Linux or anything else, stop and say Blip does not support it yet.

## Steps (Mac)

1. **Check the system.** Check for each tool and note what is missing:
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
   If the person picks another folder, use that folder instead of `~/blip-notification` in this command and in every later one, including the lines you give them to run and the uninstall line.
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
   - Blip does not start by itself yet. After every restart, they start it again in a Terminal window with `cd ~/blip-notification/app && npm run tauri dev`. Claude Code reminds them at the start of a new session when Blip is not running.
   - To uninstall: stop the app (`Ctrl+C` where it runs), run `claude plugin marketplace remove blip-notification`, then delete the Blip folder (name the one they picked) and `~/.blip`. Keep `~/.blip` if another copy of Blip still runs on this computer: they share it.

## Steps (Windows)

Windows 10 (version 1803 or later) or Windows 11. Your commands run in PowerShell (in the Claude app) or in Git Bash (in a terminal or Antigravity). Every command below works in both unless it says "PowerShell only"; from Git Bash, run those as `powershell -NoProfile -Command "<command>"`. Run one command at a time: older PowerShell does not understand `&&`. Paths with forward slashes, such as `"$HOME/blip-notification"`, work in both.

1. **Check the system.** Check for each tool and note what is missing:
   - Git for Windows: `git --version`. Required: Blip's hooks run in Git Bash, which comes with it.
   - Microsoft C++ tools (from the Build Tools or from a full Visual Studio with "Desktop development with C++"). PowerShell only:
     `& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName`
     A name such as "Visual Studio Build Tools 2026" means they are there. Nothing printed, or vswhere.exe not found, means they are missing. Either one is enough; do not install the Build Tools next to a Visual Studio that already has them. If the first build in step 5 still mentions `link.exe`, the C++ tools are missing.
   - Node.js 18 or later: `node --version`
   - Rust 1.85 or later with the MSVC toolchain: `rustc --version`, then `rustup show`, whose default host should end in `pc-windows-msvc`.
   - Claude Code's command line: `claude --version`. The plugin step needs it. People who only use the Claude Desktop app may not have it.
   WebView2, which Blip draws in, is already part of Windows 10 (1803 and later) and Windows 11.
2. **Install what is missing**, one tool at a time, asking first. Most of these are installers the person runs; give them the link and wait.
   - Git for Windows: https://git-scm.com/downloads/win (default options are fine).
   - C++ Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/. In the installer, tick "Desktop development with C++". This is a large download and can take a while.
   - Node.js: the Windows Installer (.msi) from https://nodejs.org/en/download.
   - Rust: `winget install --id Rustlang.Rustup`, or `rustup-init.exe` from https://rustup.rs. Install the Build Tools first. If Rust is already there with another toolchain: `rustup default stable-msvc`. Older than 1.85: `rustup update`.
   - Claude Code's command line, PowerShell only: `irm https://claude.ai/install.ps1 | iex`. Administrator rights are not needed. It goes into the `.local\bin` folder in the person's user folder. If `claude --version` is still not found in a new window, that folder is not on the PATH: ask the person to add `%USERPROFILE%\.local\bin` (Start, search "environment variables", Path, New), then open a new window.
   New tools are only found in a new window. After installing, ask the person to close and reopen their terminal (or restart the Claude app) and check again. Tauri's guide says some cases need a restart of the PC.
3. **Download Blip.** Ask where to put it (default `~/blip-notification`), then:
   `git clone https://github.com/Mohamed-Shahzan/blip-notification.git "$HOME/blip-notification"`
   If the person picks another folder, use that folder instead of `$HOME/blip-notification` in this command and in every later one, including the lines you give them to run and the uninstall line.
4. **Install the app's packages.** `cd "$HOME/blip-notification/app"`, then `npm install`. If PowerShell says "running scripts is disabled on this system", use `npm.cmd` instead of `npm` here and in step 5. It runs the same npm without changing any Windows setting.
5. **Build and start the Blip app in the person's own window.** Do not run it in your background: it would stop when this session ends, and Blip would disappear. Ask the person to open PowerShell from the Start menu and run these two lines:
   `cd "$HOME/blip-notification/app"`
   `npm run tauri dev` (or `npm.cmd run tauri dev`, see step 4)
   The first build takes several minutes (about 20 on our Windows test laptop). It is ready when the output shows `Running` and `blip.exe`. Wait until they say it is ready, then check that Blip is listening: `netstat -ano | findstr 47821` shows a line with `127.0.0.1:47821` and `LISTENING`. Tell the person that Blip runs while that window stays open, and that next time only those two lines are needed.
6. **Install the Claude Code plugin**, asking first, since it changes Claude Code's user settings:
   - `claude plugin marketplace add Mohamed-Shahzan/blip-notification`
   - `claude plugin install blip@blip-notification`
   - Check: `claude plugin list` shows `blip@blip-notification` as enabled.
7. **Finish.** Tell the person:
   - The plugin takes effect in new sessions. In the Claude app, open a new session; in a terminal or Antigravity, start `claude` again.
   - In the next session, Sprout appears at the top centre of the screen while Claude works, hops when it is done, and waves when Claude needs them. Right-click Sprout to hide the message text.
   - Blip does not start by itself yet. After every restart, they start it again in PowerShell with `cd "$HOME/blip-notification/app"`, then `npm run tauri dev` (or `npm.cmd run tauri dev`). Claude Code reminds them at the start of a new session when Blip is not running.
   - To uninstall: stop the app (`Ctrl+C` in its PowerShell window), run `claude plugin marketplace remove blip-notification`, then delete the Blip folder (name the one they picked) and the `.blip` folder in their user folder. Keep `.blip` if another copy of Blip still runs on this computer: they share it.

## By hand (for a person, not Claude)

You need about 15 minutes on a Mac, and 30 or more on Windows, where the first build alone takes about 20. Skip any tool you already have.

**Mac**

1. Install the tools: Apple's command line tools (`xcode-select --install`), Rust 1.85 or later ([rustup.rs](https://rustup.rs), or `rustup update`), Node.js 18 or later ([nodejs.org](https://nodejs.org)) and [Claude Code](https://claude.com/claude-code).
2. Download Blip: `git clone https://github.com/Mohamed-Shahzan/blip-notification.git ~/blip-notification`
3. Build and start the app: `cd ~/blip-notification/app && npm install && npm run tauri dev`. The first build takes several minutes. Keep this Terminal window open, because Blip runs while it does. Next time only the last command is needed.
4. In a new Terminal window, connect Claude Code: `claude plugin marketplace add Mohamed-Shahzan/blip-notification`, then `claude plugin install blip@blip-notification`.
5. Start a new Claude Code session (in the Desktop app, open a new session) and ask anything. Sprout appears while Claude works.

**Windows**

1. Install the tools: [Git for Windows](https://git-scm.com/downloads/win), [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++", Rust 1.85 or later ([rustup.rs](https://rustup.rs)), Node.js 18 or later ([nodejs.org](https://nodejs.org)) and [Claude Code](https://claude.com/claude-code). Then open a new PowerShell window.
2. Download Blip: `git clone https://github.com/Mohamed-Shahzan/blip-notification.git "$HOME/blip-notification"`
3. Build and start the app: `cd "$HOME/blip-notification/app"`, then `npm install`, then `npm run tauri dev`. If PowerShell says running scripts is disabled, type `npm.cmd` instead of `npm`. The first build takes several minutes. Keep this window open, because Blip runs while it does. Next time only the `cd` line and the last command are needed.
4. In a new PowerShell window, connect Claude Code: `claude plugin marketplace add Mohamed-Shahzan/blip-notification`, then `claude plugin install blip@blip-notification`.
5. Start a new Claude Code session (in the Claude app, open a new session) and ask anything. Sprout appears while Claude works.
