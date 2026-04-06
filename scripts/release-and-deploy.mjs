import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const rootDir = process.cwd()
const packageJsonPath = path.join(rootDir, 'package.json')
const appPath = path.join(rootDir, 'src', 'App.jsx')

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: rootDir })
  if (res.status !== 0) {
    process.exit(res.status || 1)
  }
}

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  return String(pkg.version || '').trim()
}

function toUiVersion(version) {
  const parts = version.split('.')
  const major = parts[0] || '0'
  const minor = String(Number(parts[1] || '0')).padStart(2, '0')
  return `v${major}.${minor}`
}

function syncUiVersionBadge(uiVersion) {
  const source = fs.readFileSync(appPath, 'utf8')
  const updated = source.replace(/v\d+\.\d+(?:\.\d+)?/, uiVersion)
  if (updated !== source) {
    fs.writeFileSync(appPath, updated)
  }
}

const explicitVersion = process.argv[2] && !process.argv[2].startsWith('--')
if (explicitVersion) {
  run('npm', ['version', process.argv[2], '--no-git-tag-version'])
} else {
  run('npm', ['version', 'minor', '--no-git-tag-version'])
}

const version = getVersion()
const uiVersion = toUiVersion(version)
syncUiVersionBadge(uiVersion)

run('npm', ['run', 'build'])
run('npx', ['vercel', '--prod'])
