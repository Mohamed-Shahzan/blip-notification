# Blip Notification

A small animated character that sits at the top centre of your screen and tells you when Claude Code is done, needs you, or hit an error.

**Status: work in progress, Mac first.** The engine works on the Mac and the character is being added to the window. Windows and an installer come later.

## What works today

- Blip listens to Claude Code through a small plugin of hooks. It only listens on `127.0.0.1`, so nothing leaves your machine.
- It turns the raw events into one clear state: working, needs you, done, error, or hidden.
- Tested live on the Mac in the Claude Desktop app and the Terminal: allow, deny, a question, Esc, an error turn, and closing a session.
- If Blip is closed, crashed or frozen, Claude Code behaves exactly as if Blip did not exist.

## Run it on a Mac

You need [Rust](https://rustup.rs), [Node](https://nodejs.org) and Claude Code.

```bash
cd app
npm install
npm run tauri dev
```

Then, in another terminal, from the repo folder, start Claude Code with the hooks plugin:

```bash
claude --plugin-dir hooks
```

For the Claude Desktop app, set the `CLAUDE_CODE_PLUGIN_DIRS` environment variable to the full path of the `hooks/` folder instead. A proper installer is planned.

## Built with

[Tauri](https://tauri.app) (Rust) for the window and state machine, plain JavaScript and canvas for the character, and Claude Code hooks for the events.

## License

MIT, see [LICENSE](LICENSE).
