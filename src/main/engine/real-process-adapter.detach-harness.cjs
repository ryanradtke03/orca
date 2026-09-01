'use strict'
const { spawn } = require('child_process')

const [, , command, argsJson, cwd] = process.argv
const args = JSON.parse(argsJson)

const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore' })
child.unref()
console.log(child.pid)
