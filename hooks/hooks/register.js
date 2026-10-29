// Blip mod. Tells Blip how each turn ended, which settings hooks miss after
// Esc and after a Deny (Phase 0 tests 5, 8, 9, 11).
//
// Rule: never make Claude wait. The hook passes the event on straight away and
// hands the work to $.clock.after, whose callback runs outside the event (mods
// API docs, "Run work in the background"). It writes a small file instead of
// calling Blip, so a frozen or closed Blip can never hold Claude (Session 9).

// Blip reads and deletes the files here. USERPROFILE first: on Windows HOME
// may be missing or a Git Bash path. Undefined with neither set: a relative
// path would land in the user's project.
async function inbox($) {
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  return home ? home + '/.blip/inbox/' : undefined
}

export function register(on) {
  // e.reason is answer, aborted, refusal or error; e.agentId marks a subagent turn
  on('turn.complete', async ($, e, next) => {
    const { reason, agentId } = e
    $.clock.after(1, async () => {
      try {
        const ts = await $.clock.now()
        const session = await $.session.id()
        const name = ts + '-' + Math.random().toString(36).slice(2, 8) + '.json'
        const message = { ts: ts / 1000, src: 'mod', kind: 'turn.complete', session, reason, agentId }
        const dir = await inbox($)
        if (dir) await $.fs.write(dir + name, JSON.stringify(message) + '\n')
      } catch {
        // Must never surface an error in Claude's session
      }
    })
    return next(e)
  })
}
