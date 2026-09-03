#!/usr/bin/env node
// Stand-in for the `claude` CLI's background-session surface, used only by
// real-process-adapter.test.ts. Implements just enough of `--bg`,
// `agents --json --all`, `attach <id>`, `logs <id>` and `stop <id>` to drive
// the real adapter end-to-end without needing the real CLI installed.
//
// State is kept in a JSON file (path from ORCA_FAKE_CLI_STATE) so it
// survives across the separate process invocations each subcommand makes.
// Tests seed/inspect that file directly to script a session's progress
// (idle -> waiting on a prompt -> done), since this fake has no real Claude
// behind it to produce those transitions itself.

const fs = require('fs')
const crypto = require('crypto')

const statePath = process.env.ORCA_FAKE_CLI_STATE
if (!statePath) {
  process.stderr.write('ORCA_FAKE_CLI_STATE is not set\n')
  process.exit(1)
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'))
  } catch {
    return { entries: [] }
  }
}

function writeState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state))
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const [, , subcommand, ...rest] = process.argv

if (subcommand === '--bg') {
  const state = readState()
  const id = crypto.randomBytes(4).toString('hex')

  const worker = require('child_process').spawn(
    process.execPath,
    [__filename, '--worker'],
    { detached: true, stdio: 'ignore', cwd: process.cwd() }
  )
  worker.unref()

  state.entries.push({
    id,
    pid: worker.pid,
    cwd: process.cwd(),
    status: 'idle',
    waitingFor: undefined,
    processState: 'blocked',
    screen: ''
  })
  writeState(state)

  process.stdout.write(`backgrounded · ${id}\n`)
  process.exit(0)
}

if (subcommand === '--worker') {
  const keepAlive = setInterval(() => {}, 1 << 30)
  process.on('SIGTERM', () => {
    clearInterval(keepAlive)
    process.exit(0)
  })
  process.stdin.resume()
} else if (subcommand === 'agents' && rest[0] === '--json' && rest[1] === '--all') {
  const state = readState()
  const output = state.entries.map((entry) => {
    if (isAlive(entry.pid)) {
      return {
        id: entry.id,
        pid: entry.pid,
        status: entry.status,
        waitingFor: entry.waitingFor,
        state: entry.processState
      }
    }
    return { id: entry.id, state: entry.processState === 'done' ? 'done' : 'crashed' }
  })
  process.stdout.write(JSON.stringify(output))
} else if (subcommand === 'logs') {
  const state = readState()
  const entry = state.entries.find((candidate) => candidate.id === rest[0])
  process.stdout.write(entry?.screen ?? '')
} else if (subcommand === 'stop') {
  const state = readState()
  const entry = state.entries.find((candidate) => candidate.id === rest[0])
  if (entry) {
    try {
      process.kill(entry.pid, 'SIGTERM')
    } catch {
      // already gone
    }
    entry.processState = 'done'
    writeState(state)
  }
  process.stdout.write(`stopped ${rest[0]}\n`)
} else if (subcommand === 'attach') {
  if (!process.stdin.isTTY) {
    process.stderr.write('attach requires a tty\n')
    process.exit(1)
  }
  const state = readState()
  const entry = state.entries.find((candidate) => candidate.id === rest[0])
  process.stdout.write('Attaching…\n')
  process.stdin.on('data', (chunk) => {
    const latest = readState()
    const target = latest.entries.find((candidate) => candidate.id === rest[0])
    if (target) {
      target.responses = target.responses ?? []
      target.responses.push(chunk.toString('utf-8'))
      writeState(latest)
    }
  })
  process.on('SIGTERM', () => process.exit(0))
  void entry
}
