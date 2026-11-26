// Copyright (c) 2026 Mohamed. All rights reserved. See LICENSE at https://github.com/Mohamed-Shahzan/blip-notification
// Tests hooks/scripts/check-blip.sh with stand-in pgrep, tasklist and uname,
// so it runs the same on any machine. Run: node --test tests/check-blip.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const script = new URL('../hooks/scripts/check-blip.sh', import.meta.url).pathname

// Runs the script with fake commands: { name: shell body }
function run(fakes) {
  const dir = mkdtempSync(join(tmpdir(), 'check-blip-'))
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(dir, name), 0o755)
  }
  const r = spawnSync('sh', [script], {
    input: '{"hook_event_name":"SessionStart"}',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: 'utf8',
    timeout: 5000,
  })
  return { code: r.status, out: r.stdout }
}

function assertReminder(out) {
  const j = JSON.parse(out)
  assert.match(j.systemMessage, /^Blip is not running/)
  assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.match(j.hookSpecificOutput.additionalContext, /Blip is not running/)
}

const mac = { uname: 'echo Darwin' }
const win = { uname: 'echo MINGW64_NT-10.0' }

test('Mac, Blip running: silent', () => {
  const r = run({ ...mac, pgrep: 'exit 0' })
  assert.deepEqual(r, { code: 0, out: '' })
})

test('Mac, Blip not running: reminder', () => {
  const r = run({ ...mac, pgrep: 'exit 1' })
  assert.equal(r.code, 0)
  assertReminder(r.out)
})

test('Mac, check fails: silent', () => {
  const r = run({ ...mac, pgrep: 'exit 3' })
  assert.deepEqual(r, { code: 0, out: '' })
})

test('Windows, Blip running: silent', () => {
  const r = run({ ...win, tasklist: 'echo; echo "blip.exe   1234 Console   1   80,000 K"' })
  assert.deepEqual(r, { code: 0, out: '' })
})

test('Windows, Blip not running: reminder', () => {
  const r = run({ ...win, tasklist: 'echo "INFO: No tasks are running which match the specified criteria."' })
  assert.equal(r.code, 0)
  assertReminder(r.out)
})

test('Windows, check fails: silent', () => {
  const r = run({ ...win, tasklist: 'exit 1' })
  assert.deepEqual(r, { code: 0, out: '' })
})
