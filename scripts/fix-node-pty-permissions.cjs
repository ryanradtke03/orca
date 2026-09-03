// node-pty's published prebuilt `spawn-helper` binary sometimes loses its
// executable bit in the npm tarball, which makes every pty.spawn() call fail
// with "posix_spawnp failed" until it's chmod +x'd. Runs as a postinstall
// step so a plain `npm install` keeps working for every contributor/CI run.
const fs = require('fs')
const path = require('path')

const prebuildsDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')

if (!fs.existsSync(prebuildsDir)) process.exit(0)

for (const platformArch of fs.readdirSync(prebuildsDir)) {
  const helperPath = path.join(prebuildsDir, platformArch, 'spawn-helper')
  if (fs.existsSync(helperPath)) {
    fs.chmodSync(helperPath, 0o755)
  }
}
